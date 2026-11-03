// Small CalDAV client for iCloud: just the PROPFIND/REPORT calls we need, with
// tolerant XML reading (iCloud uses varying namespace prefixes). No imports, so
// both Deno and Vitest can load it.

export const ICLOUD = "https://caldav.icloud.com/";

export class DavError extends Error {
  constructor(
    readonly code: "icloud_auth_failed" | "icloud_unreachable",
    readonly status?: number,
  ) {
    super(code);
  }
}

const tagRe = (name: string) =>
  new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*?(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>)`, "i");

/** Inner text of the first `<name>` element (any namespace prefix), or undefined. */
export function tag(xml: string, name: string): string | undefined {
  const m = xml.match(tagRe(name));
  return m ? (m[1] ?? "") : undefined;
}

/** Every `<response>` block of a multistatus document. */
export function responses(xml: string): string[] {
  const re = /<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi;
  return [...xml.matchAll(re)].map((m) => m[1] ?? "");
}

export function decode(text: string): string {
  const cdata = text.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cdata) return cdata[1] ?? "";
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

/** href inside the first `<parent>` element, resolved against `base`. */
export function hrefIn(xml: string, parent: string, base: string): string | undefined {
  const inner = tag(xml, parent);
  const href = inner !== undefined ? tag(inner, "href") : undefined;
  return href ? new URL(decode(href.trim()), base).toString() : undefined;
}

export interface DavCalendar {
  url: string;
  name: string;
  color?: string;
}

const PROPSTAT = /<(?:[\w-]+:)?propstat\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?propstat>/gi;
const succeeded = (status: string | undefined) =>
  status === undefined || /\s2\d\d\s/.test(` ${status} `);

/**
 * Properties of a response that came back fine. A 404 for an optional property
 * (like the component set) must not hide the ones that did arrive.
 */
function okProps(response: string): string {
  const stats = [...response.matchAll(PROPSTAT)];
  if (stats.length === 0) return response;
  return stats
    .map((m) => m[1] ?? "")
    .filter((p) => succeeded(tag(p, "status")))
    .join("");
}

/** Event calendars listed in a calendar-home PROPFIND (Depth: 1) response. */
export function parseCalendars(xml: string, base: string): DavCalendar[] {
  return responses(xml).flatMap((r) => {
    const props = okProps(r);
    const type = tag(props, "resourcetype") ?? "";
    if (!/<(?:[\w-]+:)?calendar\b/i.test(type)) return [];
    const comps = tag(props, "supported-calendar-component-set");
    if (comps !== undefined && !/name=["']VEVENT["']/i.test(comps)) return [];
    const href = tag(r, "href");
    if (!href) return [];
    const color = tag(props, "calendar-color")?.trim();
    return [
      {
        url: new URL(decode(href.trim()), base).toString(),
        name: decode(tag(props, "displayname")?.trim() ?? "") || "iCloud",
        color: color ? color.slice(0, 7) : undefined,
      },
    ];
  });
}

/**
 * True when every collection in the listing reported its resource type. A 207
 * may carry failed propstats; such a listing can silently miss calendars.
 */
export function listingComplete(xml: string): boolean {
  // A Depth-1 listing always includes the home itself; none at all means a cut body,
  // and so does a document that never closes its multistatus.
  const all = responses(xml);
  return (
    /<\/(?:[\w-]+:)?multistatus>\s*$/i.test(xml) &&
    all.length > 0 &&
    all.every((r) =>
      [...r.matchAll(PROPSTAT)].some(
        (m) =>
          tag(m[1] ?? "", "resourcetype") !== undefined && succeeded(tag(m[1] ?? "", "status")),
      ),
    )
  );
}

/** calendar-data payloads of a calendar-query REPORT response. */
export function parseCalendarData(xml: string): string[] {
  return responses(xml)
    .map((r) => tag(r, "calendar-data"))
    .filter((d): d is string => !!d)
    .map(decode);
}

const stamp = (t: number) =>
  new Date(t)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

export const bodies = {
  principal: `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`,
  home: `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`,
  calendars: `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"><d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/><a:calendar-color/></d:prop></d:propfind>`,
  events: (from: number, to: number) =>
    `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data><c:expand start="${stamp(from)}" end="${stamp(to)}"/></c:calendar-data></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${stamp(from)}" end="${stamp(to)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`,
};

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** One CalDAV request, following redirects without dropping credentials. */
export async function dav(
  fetcher: Fetch,
  auth: string,
  method: "PROPFIND" | "REPORT",
  url: string,
  body: string,
  depth: "0" | "1",
): Promise<{ xml: string; url: string }> {
  let target = url;
  for (let hop = 0; hop < 4; hop++) {
    // Credentials only travel over HTTPS, and only to iCloud.
    const parsed = new URL(target);
    if (parsed.protocol !== "https:" || !/(^|\.)icloud\.com$/.test(parsed.hostname)) {
      throw new DavError("icloud_unreachable");
    }
    const res = await fetcher(target, {
      method,
      redirect: "manual",
      headers: {
        Authorization: auth,
        Depth: depth,
        "Content-Type": "application/xml; charset=utf-8",
      },
      body,
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      target = new URL(res.headers.get("location") as string, target).toString();
      continue;
    }
    if (res.status === 401 || res.status === 403)
      throw new DavError("icloud_auth_failed", res.status);
    if (res.status !== 207) throw new DavError("icloud_unreachable", res.status);
    return { xml: await res.text(), url: target };
  }
  throw new DavError("icloud_unreachable", 310);
}

export const basicAuth = (user: string, password: string) =>
  `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${user}:${password}`)))}`;

/** Logs in and lists the user's event calendars. */
export async function discover(
  fetcher: Fetch,
  auth: string,
): Promise<{ calendars: DavCalendar[]; complete: boolean }> {
  const root = await dav(fetcher, auth, "PROPFIND", ICLOUD, bodies.principal, "0");
  const principal = hrefIn(root.xml, "current-user-principal", root.url);
  if (!principal) throw new DavError("icloud_unreachable", 207);
  const p = await dav(fetcher, auth, "PROPFIND", principal, bodies.home, "0");
  const home = hrefIn(p.xml, "calendar-home-set", p.url);
  if (!home) throw new DavError("icloud_unreachable", 207);
  const list = await dav(fetcher, auth, "PROPFIND", home, bodies.calendars, "1");
  return { calendars: parseCalendars(list.xml, list.url), complete: listingComplete(list.xml) };
}

/** iCalendar documents of a calendar's events in [from, to), recurrences expanded. */
export async function fetchEvents(
  fetcher: Fetch,
  auth: string,
  calendarUrl: string,
  from: number,
  to: number,
) {
  const r = await dav(fetcher, auth, "REPORT", calendarUrl, bodies.events(from, to), "1");
  return parseCalendarData(r.xml);
}
