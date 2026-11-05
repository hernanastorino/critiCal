import { describe, expect, it } from "vitest";
import {
  DEFAULTS,
  guessRole,
  importFromCalendars,
  roleOf,
  subjectName,
  subjectOf,
  visibleEvents,
} from "./calendars.js";
import { demoData, emptyData } from "./demo.js";
import { type AppData, type AppEvent, stableId } from "./model.js";
import { refresh } from "./refresh.js";
import { reducer } from "./store.js";

const NOW = Date.UTC(2026, 10, 2, 20);
let n = 0;
const id = () => `id${++n}`;

const ev = (
  eid: string,
  calendarId: string,
  title: string,
  start: number,
  end = start + 3_600_000,
): AppEvent => ({
  id: eid,
  title,
  start,
  end,
  busy: true,
  source: "icloud",
  calendarId,
});

const data = (over: Partial<AppData> = {}): AppData => ({
  ...emptyData(),
  activities: [
    {
      id: "fis",
      name: "Física I",
      color: "#00f",
      academic: true,
      maxSessionMinutes: 90,
      minBlockMinutes: 60,
    },
  ],
  calendars: [
    { id: "icloud:p", source: "icloud", externalId: "p", name: "Parciales" },
    { id: "icloud:e", source: "icloud", externalId: "e", name: "Entregas" },
    { id: "icloud:pr", source: "icloud", externalId: "pr", name: "Presentaciones" },
    { id: "icloud:t", source: "icloud", externalId: "t", name: "Trabajo" },
    { id: "google:h", source: "google", externalId: "h", name: "Feriados en Uruguay" },
  ],
  ...over,
});

describe("calendar roles", () => {
  it("guesses roles from calendar names", () => {
    expect(guessRole("Parciales")).toBe("parcial");
    expect(guessRole("Exámenes finales")).toBe("parcial");
    expect(guessRole("Entregas")).toBe("entrega");
    expect(guessRole("Presentaciones")).toBe("presentacion");
    expect(guessRole("Trabajo")).toBe("busy");
    expect(guessRole("Feriados en Uruguay")).toBe("ignore");
    expect(
      roleOf({ id: "x", source: "google", externalId: "x", name: "Parciales", role: "busy" }),
    ).toBe("busy");
  });

  it("extracts the subject from an event title", () => {
    expect(subjectOf("Parcial 2 de Física I")).toBe("fisica i");
    expect(subjectOf("Entrega TP Programación")).toBe("programacion");
    expect(subjectOf("Presentación")).toBe("");
    expect(subjectName("Parcial 2 de Física I")).toBe("Física I");
    expect(subjectName("parcial de química")).toBe("Química");
  });

  it("hides ignored calendars and makes deliveries non-blocking", () => {
    const d = data({
      events: [
        ev("a", "icloud:e", "Entrega TP", NOW + 1),
        ev("b", "google:h", "Feriado", NOW + 2),
        ev("c", "icloud:t", "Taller", NOW + 3),
        { ...ev("d", "none", "Sin calendario", NOW + 4), calendarId: undefined },
      ],
    });
    const v = visibleEvents(d);
    expect(v.map((e) => e.id)).toEqual(["a", "c", "d"]);
    expect(v[0]?.busy).toBe(false);
    expect(v[1]?.busy).toBe(true);
  });
});

describe("importFromCalendars", () => {
  const day = 86_400_000;

  it("creates reviewed tasks with defaults under matching or new activities", () => {
    const d = data({
      events: [
        ev("x1", "icloud:p", "Parcial Física I", NOW + 3 * day),
        ev("x2", "icloud:e", "Entrega TP Programación", NOW + 5 * day, NOW + 5 * day + 60_000),
        ev("x3", "icloud:pr", "Presentación", NOW + 6 * day),
        ev("x4", "icloud:t", "Taller de React", NOW + day),
        ev("old", "icloud:p", "Parcial viejo", NOW - day),
      ],
    });
    const out = importFromCalendars(d, NOW, id);
    expect(out.tasks.map((t) => t.title)).toEqual([
      "Parcial Física I",
      "Entrega TP Programación",
      "Presentación",
    ]);
    const [parcial, entrega, pres] = out.tasks;
    expect(parcial).toMatchObject({
      activityId: "fis",
      deadline: NOW + 3 * day,
      needsReview: true,
      sourceEventId: "x1",
    });
    expect(parcial?.estimateMinutes).toBe(DEFAULTS.parcial.estimate);
    expect(entrega?.deadline).toBe(NOW + 5 * day + 60_000);
    expect(out.activities.map((a) => a.name)).toEqual(["Física I", "Programación", "Presentación"]);
    expect(pres?.minMinutes).toBe(DEFAULTS.presentacion.min);
  });

  it("gives the same ids to the same event wherever it is imported", () => {
    const d = data({ events: [ev("x9", "icloud:p", "Parcial Química", NOW + 3 * day)] });
    const onPhone = importFromCalendars(d, NOW, stableId);
    const onServer = importFromCalendars(d, NOW, stableId);
    expect(onServer.tasks.map((t) => t.id)).toEqual(onPhone.tasks.map((t) => t.id));
    expect(onServer.activities.map((a) => a.id)).toEqual(onPhone.activities.map((a) => a.id));
    expect(stableId("task:x9")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(stableId("task:x9")).not.toBe(stableId("task:x10"));
  });

  it("never gives two users the same ids", () => {
    const d = data({ events: [ev("x9", "icloud:p", "Parcial Química", NOW + 3 * day)] });
    const ana = refresh({ ...d, owner: "ana" }, NOW);
    const beto = refresh({ ...d, owner: "beto" }, NOW);
    expect(refresh({ ...d, owner: "ana" }, NOW).tasks[0]?.id).toBe(ana.tasks[0]?.id);
    expect(beto.tasks[0]?.id).not.toBe(ana.tasks[0]?.id);
    expect(beto.activities.at(-1)?.id).not.toBe(ana.activities.at(-1)?.id);
  });

  it("follows moved events, does not recreate ignored tasks, and is a no-op otherwise", () => {
    const d = data({ events: [ev("x1", "icloud:p", "Parcial Física I", NOW + 86_400_000)] });
    const first = importFromCalendars(d, NOW, id);
    expect(importFromCalendars(first, NOW, id)).toBe(first);
    const moved = importFromCalendars(
      {
        ...first,
        events: [ev("x1", "icloud:p", "Parcial Física I (cambio)", NOW + 2 * 86_400_000)],
      },
      NOW,
      id,
    );
    expect(moved.tasks[0]).toMatchObject({
      deadline: NOW + 2 * 86_400_000,
      title: "Parcial Física I (cambio)",
    });
    const ignored = reducer(first, {
      type: "review",
      taskId: first.tasks[0]?.id as string,
      keep: false,
      now: NOW,
    });
    expect(ignored.tasks).toHaveLength(1);
    expect(ignored.tasks[0]).toMatchObject({ status: "dropped", needsReview: false });
    expect(importFromCalendars(emptyData(), NOW, id).tasks).toEqual([]);
  });

  it("re-imports when a calendar's role changes", () => {
    const d = data({ events: [ev("x9", "icloud:t", "Entrega informe", NOW + 86_400_000)] });
    expect(reducer(d, { type: "refresh", now: NOW }).tasks).toHaveLength(0);
    const changed = reducer(d, {
      type: "calendarRole",
      calendarId: "icloud:t",
      role: "entrega",
      now: NOW,
    });
    expect(changed.tasks).toHaveLength(1);
    expect(changed.calendars?.find((c) => c.id === "icloud:t")?.role).toBe("entrega");
    const kept = reducer(changed, {
      type: "review",
      taskId: changed.tasks[0]?.id as string,
      keep: true,
      now: NOW,
    });
    expect(kept.tasks[0]).toMatchObject({ needsReview: false, status: "active" });
  });
});

describe("tags in event titles", () => {
  it("say what an event is, whatever its calendar, except ignored ones", async () => {
    const { tagRole, untagged, eventRole, importFromCalendars, visibleEvents } = await import(
      "./calendars.js"
    );
    expect(tagRole("📝 Informe de laboratorio")).toBe("entrega");
    expect(tagRole("TP final #entrega")).toBe("entrega");
    expect(tagRole("Física #parcial")).toBe("parcial");
    expect(tagRole("Física #Examen")).toBe("parcial");
    expect(tagRole("Defensa #presentación")).toBe("presentacion");
    expect(tagRole("Cumple de Sofi")).toBeUndefined();
    expect(untagged("📝 Informe #entrega")).toBe("Informe");
    expect(untagged("#parcial")).toBe("#parcial");

    const now = Date.UTC(2026, 10, 2, 12);
    const at = (d: number) => now + d * 86_400_000;
    const base = demoData(now);
    const d = {
      ...base,
      tasks: [],
      calendars: [
        { id: "google:p", source: "google" as const, externalId: "p", name: "Personal" },
        {
          id: "google:x",
          source: "google" as const,
          externalId: "x",
          name: "Viejo",
          role: "ignore" as const,
        },
      ],
      events: [
        {
          id: "a",
          title: "📝 Informe de Física",
          start: at(3),
          end: at(3) + 3_600_000,
          busy: true,
          source: "google" as const,
          calendarId: "google:p",
        },
        {
          id: "b",
          title: "Física #parcial",
          start: at(5),
          end: at(5) + 7_200_000,
          busy: true,
          source: "google" as const,
          calendarId: "google:p",
        },
        {
          id: "c",
          title: "Nada #entrega",
          start: at(4),
          end: at(4) + 3_600_000,
          busy: true,
          source: "google" as const,
          calendarId: "google:x",
        },
      ],
    };
    expect(eventRole(d, d.events[0] as never)).toBe("entrega");
    expect(eventRole(d, d.events[2] as never)).toBe("ignore");
    const out = importFromCalendars(d, now, (s: string) => `id:${s}`);
    expect(out.tasks.map((t) => [t.title, t.deadline])).toEqual([
      ["Informe de Física", at(3) + 3_600_000],
      ["Física", at(5)],
    ]);
    // A tagged entrega is a deadline, it does not block time.
    expect(visibleEvents(d).find((e) => e.id === "a")?.busy).toBe(false);

    // A parcial is an exam; retagged as an entrega, its task stops being one.
    expect(out.tasks.find((t) => t.sourceEventId === "b")?.exam).toBe(true);
    const retyped = importFromCalendars(
      {
        ...out,
        tasks: out.tasks.map((t) => (t.sourceEventId === "b" ? { ...t, dayBeforeOnly: true } : t)),
        events: out.events.map((e) => (e.id === "b" ? { ...e, title: "Física #entrega" } : e)),
      },
      now,
      (s: string) => `id:${s}`,
    );
    expect(retyped.tasks.find((t) => t.sourceEventId === "b")).toMatchObject({
      exam: undefined,
      dayBeforeOnly: undefined,
    });
    // Removing the tag stops planning the task, keeping it as history.
    const untaggedOut = importFromCalendars(
      { ...out, events: out.events.map((e) => (e.id === "b" ? { ...e, title: "Física" } : e)) },
      now,
      (s: string) => `id:${s}`,
    );
    const retired = untaggedOut.tasks.find((t) => t.sourceEventId === "b");
    expect(retired?.status).toBe("dropped");
    expect(retired?.endedAt).toBe(now);
    // The tag back: the task returns…
    const retagged = { ...untaggedOut, events: out.events };
    const back = importFromCalendars(retagged, now, (s: string) => `id:${s}`);
    expect(back.tasks.find((t) => t.sourceEventId === "b")).toMatchObject({
      status: "active",
      endedAt: undefined,
    });
    // …unless the user dropped it themselves meanwhile.
    const byUser = {
      ...retagged,
      tasks: untaggedOut.tasks.map((t) =>
        t.sourceEventId === "b" ? { ...t, endedAt: now + 1 } : t,
      ),
    };
    expect(
      importFromCalendars(byUser, now, (s: string) => `id:${s}`).tasks.find(
        (t) => t.sourceEventId === "b",
      )?.status,
    ).toBe("dropped");
  });
});
