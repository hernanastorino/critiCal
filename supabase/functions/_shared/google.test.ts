import { describe, expect, it } from "vitest";
import { colorIdFor, diffPlan, midnight, planEvent, toRow } from "./google";

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
    expect(toRow("u", "cal", { id: "x" }, "UTC")).toBeNull();
    expect(midnight("2026-11-04", "UTC")).toBe("2026-11-04T00:00:00.000Z");
  });

  it("picks Google colours, reserving tomato for critical", () => {
    expect(colorIdFor("#FF8A00", true)).toBe("11");
    expect(colorIdFor("#0A72FF", false)).toBe("7");
    expect(colorIdFor("#E0262E", false)).not.toBe("11");
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
      "#12A150",
    );
    expect(ev).toMatchObject({
      summary: "🔴 Parcial",
      colorId: "11",
      extendedProperties: { private: { criticalBlock: "b" } },
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
