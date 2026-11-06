import { describe, expect, it, vi } from "vitest";
import { basicAuth, discover, fetchEvents } from "./caldav.js";
import { FAKE_GOOGLE_REFRESH, fakeFetch } from "./fake-providers.js";
import { accessToken, google, listCalendars, listEvents } from "./google-api.js";
import { parseIcs } from "./ics.js";

const NOW = Date.parse("2026-11-06T12:00:00Z");
const env = { googleClientId: "id", googleClientSecret: "secret" };

function install() {
  const real = vi.fn(async () => new Response("real"));
  vi.stubGlobal(
    "fetch",
    fakeFetch(real as never, () => NOW),
  );
  return real;
}

describe("invented Google", () => {
  it("accepts only its own refresh token, like a revoked grant", async () => {
    install();
    await expect(accessToken(env, "fake-google-revoked")).rejects.toMatchObject({
      code: "token_refresh_failed",
      status: 400,
      reason: "invalid_grant",
    });
    expect(await accessToken(env, FAKE_GOOGLE_REFRESH)).toBe("fake-google-access");
    await expect(google("wrong", "/users/me/calendarList")).rejects.toMatchObject({ status: 401 });
  });

  it("lists invented calendars and events, and keeps what the app writes", async () => {
    install();
    const token = await accessToken(env, FAKE_GOOGLE_REFRESH);
    const calendars = await listCalendars(token);
    expect(calendars.map((c) => c.summary)).toEqual(["Personal (local)", "Trabajo (local)"]);
    const from = new Date(NOW - 86_400_000);
    const to = new Date(NOW + 14 * 86_400_000);
    const work = await listEvents(token, "trabajo@fake", from, to);
    expect(work.some((e) => e.summary === "Cálculo 2")).toBe(true);
    expect(work.every((e) => Date.parse(e.end?.dateTime ?? "") > from.getTime())).toBe(true);

    const plan = await google<{ id: string }>(token, "/calendars", {
      method: "POST",
      body: JSON.stringify({ summary: "📚 Plan" }),
    });
    await google(token, `/users/me/calendarList/${encodeURIComponent(plan.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ backgroundColor: "#0b8043" }),
    });
    const events = `/calendars/${encodeURIComponent(plan.id)}/events`;
    const block = {
      summary: "Estudio",
      start: { dateTime: "2026-11-07T10:00:00-03:00" },
      end: { dateTime: "2026-11-07T11:00:00-03:00" },
    };
    const ev = await google<{ id: string }>(token, events, {
      method: "POST",
      body: JSON.stringify(block),
    });
    await google(token, `${events}/${ev.id}`, {
      method: "PATCH",
      body: JSON.stringify({ summary: "Estudio largo" }),
    });
    const stored = await listEvents(token, plan.id, from, to);
    expect(stored).toMatchObject([{ id: ev.id, summary: "Estudio largo" }]);
    expect(await listCalendars(token)).toContainEqual(
      expect.objectContaining({ id: plan.id, backgroundColor: "#0b8043" }),
    );
    await google(token, `${events}/${ev.id}`, { method: "DELETE" });
    expect(await listEvents(token, plan.id, from, to)).toEqual([]);
    // Deleting what is gone is fine; a missing calendar is not.
    await google(token, `${events}/${ev.id}`, { method: "DELETE" });
    await expect(google(token, "/calendars/nope/events")).rejects.toMatchObject({ status: 404 });
    const channel = await google<{ resourceId: string }>(token, `${events}/watch`, {
      method: "POST",
      body: JSON.stringify({ id: "ch" }),
    });
    expect(channel.resourceId).toBe("fake-resource");
    await google(token, `/calendars/${encodeURIComponent(plan.id)}`, { method: "DELETE" });
    expect((await listCalendars(token)).map((c) => c.id)).not.toContain(plan.id);
  });
});

describe("invented iCloud", () => {
  it("refuses a password that is not an app password", async () => {
    install();
    await expect(discover(fetch, basicAuth("yo@icloud.com", "mi-clave"))).rejects.toMatchObject({
      code: "icloud_auth_failed",
    });
  });

  it("lists one calendar with two events", async () => {
    install();
    const auth = basicAuth("yo@icloud.com", "abcd-efgh-ijkl-mnop");
    const { calendars, complete } = await discover(fetch, auth);
    expect(complete).toBe(true);
    expect(calendars).toMatchObject([{ name: "Facultad (local)", color: "#34C759" }]);
    const docs = await fetchEvents(fetch, auth, calendars[0]!.url, NOW, NOW + 14 * 86_400_000);
    const titles = docs.flatMap((d) => parseIcs(d, "America/Montevideo").map((e) => e.summary));
    expect(titles).toEqual(["Taller Programación 2", "Entrega TP Programación 2"]);
  });
});

describe("invented maps and Gemini", () => {
  it("geocodes near Montevideo and times the drive", async () => {
    install();
    const hit = await (await fetch("https://nominatim.openstreetmap.org/search?q=Casa")).json();
    expect(Number(hit[0].lat)).toBeCloseTo(-34.9, 0);
    const miss = await (
      await fetch("https://nominatim.openstreetmap.org/search?q=inexistente")
    ).json();
    expect(miss).toEqual([]);
    const res = await fetch("https://api.openrouteservice.org/v2/matrix/driving-car", {
      method: "POST",
      body: JSON.stringify({
        locations: [
          [-56.16, -34.9],
          [-56.06, -34.9],
        ],
      }),
    });
    const { durations } = await res.json();
    expect(durations[0][0]).toBe(0);
    expect(durations[0][1]).toBeGreaterThan(600);
  });

  it("reads any programa as the same invented subject", async () => {
    install();
    const api = "https://generativelanguage.googleapis.com/v1beta/models";
    expect((await fetch(`${api}?pageSize=1`, { headers: { "x-goog-api-key": "k" } })).ok).toBe(
      true,
    );
    const bad = await fetch(`${api}?pageSize=1`, { headers: { "x-goog-api-key": "fake-bad-key" } });
    expect(bad.status).toBe(400);
    const out = await (
      await fetch(`${api}/gemini:generateContent`, { method: "POST", headers: {}, body: "{}" })
    ).json();
    const syllabus = JSON.parse(out.candidates[0].content.parts[0].text);
    expect(syllabus.subject).toBe("Probabilidad y Estadística");
  });

  it("leaves every other host to the real fetch", async () => {
    const real = install();
    expect(await (await fetch("http://127.0.0.1:55321/rest/v1/tasks")).text()).toBe("real");
    expect(real).toHaveBeenCalledOnce();
  });
});
