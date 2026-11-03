import { describe, expect, it } from "vitest";
import {
  basicAuth,
  DavError,
  decode,
  discover,
  type Fetch,
  fetchEvents,
  hrefIn,
  listingComplete,
  parseCalendars,
  tag,
} from "./caldav";

const multistatus = (body: string) =>
  `<?xml version="1.0"?><multistatus xmlns="DAV:">${body}</multistatus>`;

const routes: Record<string, (init: RequestInit) => Response> = {
  "https://caldav.icloud.com/": () =>
    new Response(null, { status: 301, headers: { location: "https://p01-caldav.icloud.com/" } }),
  "https://p01-caldav.icloud.com/": () =>
    new Response(
      multistatus(
        `<response><href>/</href><propstat><prop><current-user-principal><href>/123/principal/</href></current-user-principal></prop></propstat></response>`,
      ),
      { status: 207 },
    ),
  "https://p01-caldav.icloud.com/123/principal/": () =>
    new Response(
      multistatus(
        `<response><href>/123/principal/</href><propstat><prop><calendar-home-set xmlns="urn:ietf:params:xml:ns:caldav"><href xmlns="DAV:">https://p01-caldav.icloud.com:443/123/calendars/</href></calendar-home-set></prop></propstat></response>`,
      ),
      { status: 207 },
    ),
  "https://p01-caldav.icloud.com/123/calendars/": () =>
    new Response(
      `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">
        <d:response><d:href>/123/calendars/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
        <d:response><d:href>/123/calendars/parciales/</d:href><d:propstat><d:prop>
          <d:displayname>Parciales &amp; finales</d:displayname>
          <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
          <c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>
          <a:calendar-color>#FF2968FF</a:calendar-color>
        </d:prop></d:propstat></d:response>
        <d:response><d:href>/123/calendars/tasks/</d:href><d:propstat><d:prop>
          <d:displayname>Recordatorios</d:displayname>
          <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
          <c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>
        </d:prop></d:propstat></d:response>
        <d:response><d:href>/123/calendars/sin-nombre/</d:href><d:propstat><d:prop><d:resourcetype><c:calendar/></d:resourcetype></d:prop></d:propstat></d:response>
      </d:multistatus>`,
      { status: 207 },
    ),
  "https://p01-caldav.icloud.com/123/calendars/parciales/": (init) => {
    expect(String(init.body)).toMatch(/<c:expand start="\d{8}T\d{6}Z"/);
    return new Response(
      multistatus(
        `<response><href>/a.ics</href><propstat><prop><calendar-data xmlns="urn:ietf:params:xml:ns:caldav">BEGIN:VCALENDAR&#13;
BEGIN:VEVENT&#13;
SUMMARY:Parcial F&amp;Q&#13;
END:VEVENT&#13;
END:VCALENDAR</calendar-data></prop></propstat></response><response><href>/b.ics</href><propstat><prop><calendar-data><![CDATA[BEGIN:VCALENDAR]]></calendar-data></prop></propstat></response>`,
      ),
      { status: 207 },
    );
  },
};

const fakeFetch =
  (status?: number): Fetch =>
  async (url, init) => {
    expect((init.headers as Record<string, string>).Authorization).toBe(
      basicAuth("yo@icloud.com", "abcd-efgh-ijkl-mnop"),
    );
    if (status) return new Response("", { status });
    const route = routes[url];
    if (!route) return new Response("", { status: 404 });
    return route(init);
  };

const auth = basicAuth("yo@icloud.com", "abcd-efgh-ijkl-mnop");

describe("caldav", () => {
  it("discovers event calendars through redirects", async () => {
    const { calendars, complete } = await discover(fakeFetch(), auth);
    expect(complete).toBe(true);
    expect(calendars).toEqual([
      {
        url: "https://p01-caldav.icloud.com/123/calendars/parciales/",
        name: "Parciales & finales",
        color: "#FF2968",
      },
      {
        url: "https://p01-caldav.icloud.com/123/calendars/sin-nombre/",
        name: "iCloud",
        color: undefined,
      },
    ]);
  });

  it("flags listings where a collection's type did not come back", () => {
    const ok = `<multistatus><response><href>/c/</href><propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`;
    const failed = `<multistatus><response><href>/c/</href><propstat><prop><resourcetype/></prop><status>HTTP/1.1 404 Not Found</status></propstat><propstat><prop><displayname>X</displayname></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`;
    const missing = `<multistatus><response><href>/c/</href><propstat><prop><displayname>X</displayname></prop></propstat></response></multistatus>`;
    expect(listingComplete(ok)).toBe(true);
    expect(listingComplete(failed)).toBe(false);
    expect(listingComplete(missing)).toBe(false);
  });

  it("fetches expanded events", async () => {
    const docs = await fetchEvents(
      fakeFetch(),
      auth,
      "https://p01-caldav.icloud.com/123/calendars/parciales/",
      0,
      86_400_000,
    );
    expect(docs[0]).toContain("SUMMARY:Parcial F&Q");
    expect(docs[1]).toBe("BEGIN:VCALENDAR");
  });

  it("tells a rejected password apart from other failures", async () => {
    await expect(discover(fakeFetch(401), auth)).rejects.toMatchObject({
      code: "icloud_auth_failed",
      status: 401,
    });
    await expect(discover(fakeFetch(503), auth)).rejects.toMatchObject({
      code: "icloud_unreachable",
      status: 503,
    });
    const loop: Fetch = async (url) =>
      new Response(null, { status: 302, headers: { location: url } });
    await expect(discover(loop, auth)).rejects.toBeInstanceOf(DavError);
    const insecure: Fetch = async () =>
      new Response(null, { status: 301, headers: { location: "http://caldav.icloud.com/" } });
    await expect(discover(insecure, auth)).rejects.toMatchObject({ code: "icloud_unreachable" });
    const elsewhere: Fetch = async () =>
      new Response(null, { status: 301, headers: { location: "https://evil.example/" } });
    await expect(discover(elsewhere, auth)).rejects.toMatchObject({ code: "icloud_unreachable" });
    const empty: Fetch = async () =>
      new Response(multistatus("<response><href>/</href></response>"), { status: 207 });
    await expect(discover(empty, auth)).rejects.toMatchObject({
      code: "icloud_unreachable",
      status: 207,
    });
  });

  it("reads tags regardless of namespace prefix", () => {
    expect(tag("<x:displayname>Hola</x:displayname>", "displayname")).toBe("Hola");
    expect(tag("<collection/>", "collection")).toBe("");
    expect(tag("<a/>", "b")).toBeUndefined();
    expect(hrefIn("<p><href>/x/</href></p>", "p", "https://h/")).toBe("https://h/x/");
    expect(hrefIn("<q/>", "p", "https://h/")).toBeUndefined();
    expect(decode("&lt;a&gt; &quot;b&quot; &apos;c&apos; &#65;&amp;")).toBe("<a> \"b\" 'c' A&");
    expect(decode("A&#xD;&#xA;B")).toBe("A\r\nB");
    expect(
      parseCalendars(
        multistatus("<response><resourcetype><calendar/></resourcetype></response>"),
        "https://h/",
      ),
    ).toEqual([]);
  });
});
