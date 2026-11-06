// Development only: invented answers from Google Calendar, iCloud (CalDAV), OpenStreetMap,
// OpenRouteService and Gemini, so the app runs end to end against the local Supabase
// without real accounts. The Vite dev server (dev-api.ts) installs it when
// VITE_FAKE_PROVIDERS=1; no deployed function imports it.

/** The refresh token that works. Anything else is refused like a revoked grant. */
export const FAKE_GOOGLE_REFRESH = "fake-google-refresh";
const ACCESS = "fake-google-access";
/** iCloud takes any Apple ID with a password shaped like an app-specific one. */
const APP_PASSWORD = /^[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}$/;

const GOOGLE = "https://www.googleapis.com/calendar/v3";
const DAY = 86_400_000;
/** Montevideo has no daylight saving time. */
const OFFSET = "-03:00";

type Json = Record<string, unknown>;
interface FakeEvent extends Json {
  id: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
}

const reply = (body: unknown, status = 200) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** YYYY-MM-DD in Montevideo, `days` after `now`. */
function localDate(now: number, days: number): string {
  return new Date(now + days * DAY - 3 * 3_600_000).toISOString().slice(0, 10);
}

const at = (date: string, hhmm: string) => `${date}T${hhmm}:00${OFFSET}`;

/** The invented Google calendars and their events around `now`. */
function googleSeed(now: number): { calendars: Json[]; events: Map<string, FakeEvent[]> } {
  const personal: FakeEvent[] = [];
  const trabajo: FakeEvent[] = [];
  for (let d = -7; d < 28; d++) {
    const date = localDate(now, d);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (weekday >= 1 && weekday <= 5) {
      trabajo.push({
        id: `trabajo-${date}`,
        summary: "Trabajo",
        start: { dateTime: at(date, "09:00") },
        end: { dateTime: at(date, "13:00") },
        location: "Av. 18 de Julio 1234, Montevideo",
      });
    }
    if (weekday === 2 || weekday === 4) {
      trabajo.push({
        id: `calculo-${date}`,
        summary: "Cálculo 2",
        start: { dateTime: at(date, "18:00") },
        end: { dateTime: at(date, "20:00") },
        location: "Facultad de Ingeniería, Montevideo",
      });
    }
  }
  personal.push(
    {
      id: "parcial-fisica",
      summary: "Parcial Física 1",
      start: { dateTime: at(localDate(now, 10), "09:00") },
      end: { dateTime: at(localDate(now, 10), "12:00") },
    },
    {
      id: "cumple",
      summary: "Cumpleaños de Ana",
      transparency: "transparent",
      start: { date: localDate(now, 3) },
      end: { date: localDate(now, 4) },
    },
    {
      id: "dentista",
      summary: "Dentista",
      start: { dateTime: at(localDate(now, 2), "15:00") },
      end: { dateTime: at(localDate(now, 2), "16:00") },
      location: "Bulevar Artigas 1000, Montevideo",
    },
  );
  return {
    calendars: [
      { id: "personal@fake", summary: "Personal (local)", backgroundColor: "#4285f4" },
      { id: "trabajo@fake", summary: "Trabajo (local)", backgroundColor: "#f4511e" },
    ],
    events: new Map([
      ["personal@fake", personal],
      ["trabajo@fake", trabajo],
    ]),
  };
}

const startOf = (e: FakeEvent) => Date.parse(e.start.dateTime ?? `${e.start.date}T00:00:00Z`);
const endOf = (e: FakeEvent) => Date.parse(e.end.dateTime ?? `${e.end.date}T00:00:00Z`);

/** Google Calendar's REST API, kept in memory: invented calendars plus whatever the app writes. */
function fakeGoogle(now: () => number) {
  const seeded = googleSeed(now());
  const calendars: Json[] = [...seeded.calendars];
  const events = seeded.events;
  let next = 1;

  return async (url: URL, init: RequestInit): Promise<Response> => {
    if (url.hostname === "oauth2.googleapis.com") {
      const form = new URLSearchParams(String(init.body ?? ""));
      return form.get("refresh_token") === FAKE_GOOGLE_REFRESH
        ? reply({ access_token: ACCESS, expires_in: 3600 })
        : reply({ error: "invalid_grant" }, 400);
    }
    const auth = new Headers(init.headers).get("authorization");
    if (auth !== `Bearer ${ACCESS}`) return reply({ error: { code: 401 } }, 401);
    const method = (init.method ?? "GET").toUpperCase();
    const path = url.pathname.replace("/calendar/v3", "").split("/").map(decodeURIComponent);
    const body = init.body ? (JSON.parse(String(init.body)) as Json) : {};
    // ["", "users", "me", "calendarList", id?]
    if (path[1] === "users" && path[3] === "calendarList") {
      if (method === "GET") return reply({ items: calendars });
      const cal = calendars.find((c) => c.id === path[4]);
      if (!cal) return reply({ error: { code: 404 } }, 404);
      Object.assign(cal, body);
      return reply(cal);
    }
    if (path[1] === "channels") return reply(null, 204);
    if (path[1] !== "calendars") return reply({ error: { code: 404 } }, 404);
    const calId = path[2];
    if (calId === undefined) {
      const cal = { id: `plan-${next++}@fake`, summary: String(body.summary ?? "") };
      calendars.push(cal);
      events.set(cal.id, []);
      return reply(cal);
    }
    const list = events.get(calId);
    if (!list) return reply({ error: { code: 404 } }, 404);
    if (path[3] === undefined && method === "DELETE") {
      calendars.splice(
        calendars.findIndex((c) => c.id === calId),
        1,
      );
      events.delete(calId);
      return reply(null, 204);
    }
    if (path[4] === "watch") {
      return reply({ id: body.id, resourceId: "fake-resource", expiration: `${now() + 7 * DAY}` });
    }
    const eventId = path[4];
    if (eventId === undefined && method === "GET") {
      const from = Date.parse(url.searchParams.get("timeMin") ?? "");
      const to = Date.parse(url.searchParams.get("timeMax") ?? "");
      return reply({ items: list.filter((e) => endOf(e) > from && startOf(e) < to) });
    }
    if (eventId === undefined && method === "POST") {
      const ev = { ...body, id: `ev${next++}` } as FakeEvent;
      list.push(ev);
      return reply(ev);
    }
    const i = list.findIndex((e) => e.id === eventId);
    if (i < 0) return reply({ error: { code: 404 } }, 404);
    if (method === "DELETE") {
      list.splice(i, 1);
      return reply(null, 204);
    }
    if (method === "PATCH") {
      Object.assign(list[i] as FakeEvent, body);
      return reply(list[i]);
    }
    return reply(list[i]);
  };
}

const multistatus = (inner: string) =>
  new Response(
    `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">${inner}</d:multistatus>`,
    { status: 207 },
  );

const icsStamp = (t: number) =>
  new Date(t)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

/** One invented iCloud calendar ("Facultad (local)") with two events. */
function fakeICloud(now: () => number) {
  return async (url: URL, init: RequestInit): Promise<Response> => {
    const auth = new Headers(init.headers).get("authorization") ?? "";
    const [, password = ""] = atob(auth.replace(/^Basic\s+/i, "")).split(":");
    if (!APP_PASSWORD.test(password)) return new Response("", { status: 401 });
    if (url.pathname === "/") {
      return multistatus(
        `<d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/fake/principal/</d:href></d:current-user-principal></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
      );
    }
    if (url.pathname === "/fake/principal/") {
      return multistatus(
        `<d:response><d:href>/fake/principal/</d:href><d:propstat><d:prop><c:calendar-home-set><d:href>/fake/calendars/</d:href></c:calendar-home-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
      );
    }
    if (url.pathname === "/fake/calendars/") {
      return multistatus(
        `<d:response><d:href>/fake/calendars/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>` +
          `<d:response><d:href>/fake/calendars/facultad/</d:href><d:propstat><d:prop><d:displayname>Facultad (local)</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set><a:calendar-color>#34C759FF</a:calendar-color></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
      );
    }
    if (url.pathname === "/fake/calendars/facultad/") {
      const day = (n: number, h: number) =>
        Date.parse(`${localDate(now(), n)}T00:00:00Z`) + (h + 3) * 3_600_000;
      const vevent = (uid: string, title: string, from: number, to: number, where?: string) =>
        [
          "BEGIN:VCALENDAR",
          "BEGIN:VEVENT",
          `UID:${uid}`,
          `SUMMARY:${title}`,
          `DTSTART:${icsStamp(from)}`,
          `DTEND:${icsStamp(to)}`,
          ...(where ? [`LOCATION:${where}`] : []),
          "END:VEVENT",
          "END:VCALENDAR",
        ].join("\r\n");
      const docs = [
        vevent(
          "taller@fake",
          "Taller Programación 2",
          day(3, 14),
          day(3, 16),
          "Facultad de Ingeniería, Montevideo",
        ),
        vevent("entrega@fake", "Entrega TP Programación 2", day(6, 23), day(6, 23.5)),
      ];
      return multistatus(
        docs
          .map(
            (d, i) =>
              `<d:response><d:href>/fake/calendars/facultad/${i}.ics</d:href><d:propstat><d:prop><c:calendar-data><![CDATA[${d}]]></c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
          )
          .join(""),
      );
    }
    return new Response("", { status: 404 });
  };
}

/** A stable point around Montevideo for each address; "inexistente" is not found. */
function fakeGeocode(url: URL): Response {
  const q = url.searchParams.get("q") ?? "";
  if (/inexistente/i.test(q)) return reply([]);
  let h = 0;
  for (const ch of q) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return reply([
    { lat: `${-34.9 + (h % 1000) / 10_000}`, lon: `${-56.16 + ((h >> 10) % 1000) / 10_000}` },
  ]);
}

/** Driving seconds at an average 30 km/h along the straight line. */
function fakeMatrix(init: RequestInit): Response {
  const { locations } = JSON.parse(String(init.body)) as { locations: [number, number][] };
  const km = ([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]) =>
    Math.hypot((lon2 - lon1) * 91, (lat2 - lat1) * 111);
  return reply({ durations: locations.map((a) => locations.map((b) => (km(a, b) / 30) * 3600)) });
}

/** Gemini: "fake-bad-key" is refused; a programa always reads as the same invented subject. */
function fakeGemini(url: URL, init: RequestInit, now: () => number): Response {
  if (new Headers(init.headers).get("x-goog-api-key") === "fake-bad-key") {
    return reply({ error: { code: 400 } }, 400);
  }
  if (!url.pathname.endsWith(":generateContent")) return reply({ models: [] });
  const syllabus = {
    subject: "Probabilidad y Estadística",
    units: [
      { title: "Probabilidad", hours: 10 },
      { title: "Variables aleatorias", hours: 12 },
      { title: "Inferencia", hours: 14 },
    ],
    assessments: [
      {
        title: "Primer parcial",
        kind: "parcial",
        date: localDate(now(), 21),
        hours: 12,
        units: ["Probabilidad", "Variables aleatorias"],
        weights: { Probabilidad: 40, "Variables aleatorias": 60 },
      },
    ],
  };
  return reply({ candidates: [{ content: { parts: [{ text: JSON.stringify(syllabus) }] } }] });
}

/** `fetch` that answers for the providers above and passes everything else to `real`. */
export function fakeFetch(real: typeof fetch, now: () => number = Date.now): typeof fetch {
  const google = fakeGoogle(now);
  const icloud = fakeICloud(now);
  return async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "oauth2.googleapis.com" || url.href.startsWith(GOOGLE)) {
      return google(url, init);
    }
    if (/(^|\.)icloud\.com$/.test(url.hostname)) return icloud(url, init);
    if (url.hostname === "nominatim.openstreetmap.org") return fakeGeocode(url);
    if (url.hostname === "api.openrouteservice.org") return fakeMatrix(init);
    if (url.hostname === "generativelanguage.googleapis.com") return fakeGemini(url, init, now);
    return real(input, init);
  };
}
