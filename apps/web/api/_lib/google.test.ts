import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CRITICAL_COLOR_ID,
  choosePlanCalendar,
  diffPlan,
  midnight,
  PLAN_CALENDAR,
  PLAN_COLOR_ID,
  planEvent,
  sameEvent,
  toRow,
} from "./google.js";
import { google, retryDelay, SyncError } from "./google-api.js";

describe("google helpers", () => {
  it("maps timed, all-day, free and cancelled events", () => {
    const timed = toRow(
      "u",
      "cal",
      {
        id: "e1",
        summary: "Clase",
        location: "Facultad",
        htmlLink: "https://calendar.google.com/e1",
        start: { dateTime: "2026-11-03T09:00:00-03:00" },
        end: { dateTime: "2026-11-03T11:00:00-03:00" },
      },
      "America/Montevideo",
    );
    expect(timed).toMatchObject({
      external_id: "cal|e1",
      start_at: "2026-11-03T12:00:00.000Z",
      busy: true,
      tentative: false,
      all_day: false,
      location: "Facultad",
    });
    const allDay = toRow(
      "u",
      "cal",
      {
        id: "e2",
        transparency: "transparent",
        start: { date: "2026-11-04" },
        end: { date: "2026-11-05" },
      },
      "America/Montevideo",
    );
    expect(allDay).toMatchObject({
      title: "(sin título)",
      busy: false,
      all_day: true,
      start_at: "2026-11-04T03:00:00.000Z",
    });
    expect(toRow("u", "cal", { id: "x", status: "cancelled" }, "UTC")).toBeNull();
    expect(
      toRow(
        "u",
        "cal",
        {
          id: "t",
          status: "tentative",
          start: { dateTime: "2026-11-03T09:00:00-03:00" },
          end: { dateTime: "2026-11-03T10:00:00-03:00" },
        },
        "UTC",
      )?.tentative,
    ).toBe(true);
    expect(toRow("u", "cal", { id: "x" }, "UTC")).toBeNull();
    expect(midnight("2026-11-04", "UTC")).toBe("2026-11-04T00:00:00.000Z");
  });

  it("paints plan events green and critical ones red, marked too", () => {
    const ev = planEvent(
      {
        id: "b",
        task_id: "t",
        start_at: "s",
        end_at: "e",
        level: "critical",
        google_event_id: null,
      },
      "Parcial",
    );
    expect(ev).toMatchObject({
      summary: "🔴 Parcial",
      colorId: CRITICAL_COLOR_ID,
      extendedProperties: { private: { criticalBlock: "b" } },
    });
    expect(
      planEvent(
        { id: "c", task_id: "t", start_at: "s", end_at: "e", level: "ok", google_event_id: null },
        "Mate",
      ),
    ).toMatchObject({ summary: "Mate", colorId: PLAN_COLOR_ID });
  });

  it("keeps exactly one Plan calendar", () => {
    const items = [
      { id: "a", summary: PLAN_CALENDAR },
      { id: "x", summary: "Trabajo" },
      { id: "b", summary: PLAN_CALENDAR },
      { id: "c", summary: PLAN_CALENDAR },
    ];
    expect(choosePlanCalendar(items, "b")).toEqual({ keep: items[2], remove: ["a", "c"] });
    expect(choosePlanCalendar(items, "gone")).toEqual({ keep: items[0], remove: ["b", "c"] });
    expect(choosePlanCalendar([items[1] as (typeof items)[number]], null)).toEqual({
      keep: undefined,
      remove: [],
    });
  });

  it("diffs planned blocks against the Plan calendar", () => {
    const block = (id: string) => ({
      id,
      task_id: "t",
      start_at: "s",
      end_at: "e",
      level: "ok",
      google_event_id: null,
    });
    const existing = [
      { id: "g1", extendedProperties: { private: { criticalBlock: "keep" } } },
      { id: "g2", extendedProperties: { private: { criticalBlock: "gone" } } },
      { id: "g3", status: "cancelled", extendedProperties: { private: { criticalBlock: "new" } } },
    ];
    const d = diffPlan([block("keep"), block("new")], existing);
    expect(d.create.map((b) => b.id)).toEqual(["new"]);
    expect(d.update).toEqual([{ ...block("keep"), google_event_id: "g1" }]);
    expect(d.remove).toEqual(["g2"]);
  });
});

describe("plan events and Google's API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("leave an unchanged event alone", () => {
    const wanted = planEvent(
      {
        id: "b",
        task_id: "t",
        start_at: "2026-11-05T12:00:00+00:00",
        end_at: "2026-11-05T13:00:00+00:00",
        level: "ok",
        google_event_id: "g",
      },
      "Mate",
    );
    const shown = {
      id: "g",
      summary: "Mate",
      // Google answers in the calendar's zone: the same instant.
      start: { dateTime: "2026-11-05T09:00:00-03:00" },
      end: { dateTime: "2026-11-05T10:00:00-03:00" },
      colorId: PLAN_COLOR_ID,
    };
    expect(sameEvent(shown, wanted)).toBe(true);
    expect(sameEvent({ ...shown, summary: "Física" }, wanted)).toBe(false);
    expect(sameEvent({ ...shown, colorId: CRITICAL_COLOR_ID }, wanted)).toBe(false);
  });

  it("retry rate limits, treat a deleted event as gone and say the status", async () => {
    retryDelay.ms = 0;
    const answers = [
      new Response(JSON.stringify({ error: { errors: [{ reason: "rateLimitExceeded" }] } }), {
        status: 403,
      }),
      new Response(JSON.stringify({ id: "ok" }), { status: 200 }),
    ];
    vi.stubGlobal("fetch", async () => answers.shift() as Response);
    expect(await google<{ id: string }>("t", "/x", { method: "POST" })).toEqual({ id: "ok" });

    // A 5xx on a create is not repeated: Google may have made the event already.
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      return new Response("", { status: 503 });
    });
    await expect(google("t", "/x", { method: "POST" })).rejects.toBeInstanceOf(SyncError);
    expect(calls).toBe(1);
    calls = 0;
    await expect(google("t", "/x", { method: "PATCH" })).rejects.toBeInstanceOf(SyncError);
    expect(calls).toBe(4);

    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    expect(await google("t", "/x", { method: "DELETE" })).toEqual({});
    const failed = (await google("t", "/x", { method: "PATCH" }).catch((e) => e)) as SyncError;
    expect(failed).toBeInstanceOf(SyncError);
    expect(failed.code).toBe("google_api_error");
    expect(failed.message).toBe("google_api_error (404)");
  });
});
