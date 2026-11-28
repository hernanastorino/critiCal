// 12th round: the data error classes the database never accepts, a backup from another
// account or the demo that gets new ids, and extras that are dropped one by one.
import { describe, expect, it } from "vitest";
import { NOW } from "./atacante11Kit.js";
import { exportJson, parseBackup } from "./backup.js";
import { isPermanent } from "./data.js";
import { demoData } from "./demo.js";
import { type AppData, newId } from "./model.js";

const HOUR = 3_600_000;
const MINE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("1. Errores de la base que no se arreglan reintentando", () => {
  it.each(["22P02", "22001", "23505", "23503", "23514", "42501"])("%s es permanente", (code) => {
    expect(isPermanent({ code })).toBe(true);
  });
  it.each(["08006", "40001", "57014", "PGRST301", "", undefined])("%s se reintenta", (code) => {
    expect(isPermanent({ code })).toBe(false);
  });
  it("lo que no es un error de la base no es permanente", () => {
    expect(isPermanent(null)).toBe(false);
    expect(isPermanent("22P02")).toBe(false);
    expect(isPermanent(new TypeError("Failed to fetch"))).toBe(false);
  });
});

/** An account's data with every kind of reference between ids filled in. */
function accountData(owner: string): AppData {
  const base = demoData(NOW);
  const [activity, other] = [newId(), newId()];
  const [t1, t2] = [newId(), newId()];
  const [u1, u2] = [newId(), newId()];
  const [p1, p2] = [newId(), newId()];
  const template = base.tasks.at(0);
  const act = base.activities.at(0);
  if (!template || !act) throw new Error("the demo has no data");
  const task = (id: string, activityId: string, units: AppData["tasks"][number]["units"]) => ({
    ...template,
    id,
    activityId,
    units,
  });
  const tasks = [
    task(t1, activity, [{ id: u1, title: "a", estimateMinutes: 60 }]),
    task(t2, other, [{ id: u2, title: "b", estimateMinutes: 60 }]),
  ];
  const block = (taskId: string, activityId: string, at: number) => ({
    id: `${taskId}@${at}`,
    taskId,
    activityId,
    start: at,
    end: at + HOUR,
  });
  const [b1, b2, b3] = [
    block(t1, activity, NOW + HOUR),
    block(t2, other, NOW + 3 * HOUR),
    block(t1, activity, NOW + 5 * HOUR),
  ];
  return {
    ...base,
    owner,
    activities: [
      { ...act, id: activity },
      { ...act, id: other, name: "Otra", color: "#0A72FF" },
    ],
    tasks,
    plan: [b1, b2],
    pins: [b3],
    checkIns: [
      {
        id: newId(),
        blockId: b1.id,
        taskId: t1,
        status: "done",
        minutesDone: 60,
        unitIds: [u1],
        createdAt: NOW,
      },
    ],
    proposals: [{ id: "conflict@1", message: "m", plan: [b2], conflicts: [b2.id], createdAt: NOW }],
    places: [
      { id: p1, name: "Casa", aliases: [], isHome: true },
      { id: p2, name: "Facu", aliases: [] },
    ],
    travelTimes: [{ from: p1, to: p2, minutes: 20, manual: false }],
    applied: [
      {
        id: "d1",
        label: "Priorizar",
        at: NOW,
        before: [tasks[0] as AppData["tasks"][number]],
        dropped: [t2],
        after: { [t1]: "active" },
        afterMinutes: { [t1]: { min: 10, estimate: 20 } },
        addedBlocks: [b3.id],
        skippedUnits: [u2],
        skipUntil: { [t2]: NOW },
        startAfter: { [t1]: { now: true } },
      },
    ],
    planHistory: [
      {
        at: NOW,
        label: "Reorganizar",
        pins: [b3],
        today: [b1],
        overrides: [],
        proposals: [
          { id: "conflict@2", message: "m", plan: [b1], conflicts: [b1.id], createdAt: NOW },
        ],
      },
    ],
  };
}

/** Every id in the data (uuid text), in a fixed order, for pairing old with new. */
function idsOf(d: AppData): string[] {
  return [
    ...d.activities.map((a) => a.id),
    ...d.tasks.flatMap((t) => [t.id, ...t.units.map((u) => u.id)]),
    ...d.checkIns.map((c) => c.id),
    ...(d.places ?? []).map((p) => p.id),
  ];
}

const parse = (d: AppData, account?: string) => {
  const r = parseBackup(exportJson(d, NOW), account === undefined ? {} : { account });
  if ("error" in r) throw new Error(r.error);
  return r;
};

describe("2. Respaldo de otra cuenta o del demo: ids nuevos con cuenta", () => {
  it("cuenta A a cuenta B: todos los ids cambian y las referencias siguen apuntando", () => {
    const a = accountData(OTHER);
    const b = parse(a, MINE).data;
    expect(b.owner).toBe(MINE);
    const [before, after] = [idsOf(a), idsOf(b)];
    expect(after).toHaveLength(before.length);
    // Same file, with every old id swapped for the new one at the same position.
    let text = JSON.stringify(a);
    for (const [old, now] of before.map((x, i) => [x, after.at(i) ?? ""] as const)) {
      expect(now).not.toBe(old);
      text = text.split(old).join(now);
    }
    expect(b).toEqual({ ...JSON.parse(text), owner: MINE, busRoutes: [], planHistory: undefined });
  });

  it("los bloques conservan la forma «tarea@inicio» con la tarea nueva", () => {
    const b = parse(accountData(OTHER), MINE).data;
    for (const x of [...b.plan, ...(b.pins ?? [])]) {
      expect(x.id).toBe(`${x.taskId}@${x.start}`);
      expect(b.tasks.some((t) => t.id === x.taskId)).toBe(true);
      expect(b.activities.some((t) => t.id === x.activityId)).toBe(true);
    }
    const c = b.checkIns.at(0);
    expect(b.plan.some((x) => x.id === c?.blockId)).toBe(true);
  });

  it("los ids nuevos no se repiten entre cuentas", () => {
    const a = accountData(OTHER);
    const once = idsOf(parse(a, MINE).data);
    const twice = idsOf(parse(a, MINE).data);
    expect(once.some((id) => twice.includes(id))).toBe(false);
  });

  it("el demo a una cuenta: ids uuid nuevos y todo enlazado", () => {
    const d = demoData(NOW);
    const r = parse(d, MINE).data;
    expect(r.owner).toBe(MINE);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const id of idsOf(r)) expect(id).toMatch(uuid);
    const acts = new Set(r.activities.map((x) => x.id));
    for (const t of r.tasks) expect(acts.has(t.activityId)).toBe(true);
    expect(r.tasks.map((t) => t.title)).toEqual(d.tasks.map((t) => t.title));
  });

  it("la misma cuenta: los ids quedan y reimportar no duplica", () => {
    const a = accountData(MINE);
    const r = parse(a, MINE).data;
    expect(r).toEqual({ ...JSON.parse(JSON.stringify(a)), busRoutes: [], planHistory: undefined });
    const again = parse(r, MINE).data;
    expect(again).toEqual(r);
  });

  it("la misma cuenta pero con ids que no son uuid: se renuevan", () => {
    const a = { ...demoData(NOW), owner: MINE };
    const r = parse(a, MINE).data;
    expect(r.tasks.at(0)?.id).not.toBe(a.tasks.at(0)?.id);
  });

  it("sin cuenta (demo) los ids se respetan", () => {
    const a = accountData(OTHER);
    expect(parse(a).data).toEqual({
      ...JSON.parse(JSON.stringify(a)),
      busRoutes: [],
      planHistory: undefined,
    });
  });

  it("con cuenta ya no se rechaza un id que no es uuid", () => {
    expect("data" in parseBackup(exportJson(demoData(NOW), NOW), { account: MINE })).toBe(true);
  });
});

describe("3. Extras mal formados: se descarta solo lo inválido", () => {
  const calendar = { id: "google:a", source: "google", externalId: "a", name: "A" };
  const file = (extras: Record<string, unknown>) =>
    JSON.stringify({
      app: "critiCal",
      version: 2,
      exportedAt: NOW,
      data: { ...JSON.parse(JSON.stringify(demoData(NOW))), ...extras },
    });
  const read = (extras: Record<string, unknown>) => {
    const r = parseBackup(file(extras));
    if ("error" in r) throw new Error(r.error);
    return r;
  };

  it("un calendario roto se va, el bueno queda, y se avisa", () => {
    const r = read({ calendars: [calendar, { id: 1 }] });
    expect(r.data.calendars).toEqual([calendar]);
    expect(r.dropped?.join(" ")).toMatch(/calendario/i);
  });

  it("cada extra descarta solo su entrada mala", () => {
    const good = {
      movedEvents: { eventId: "e", from: NOW, start: NOW, end: NOW + HOUR },
      tentativeSeen: { id: "t", title: "x", start: NOW, end: NOW + HOUR },
      mealChoices: { date: "2026-11-18", kind: "cena", skip: true },
    };
    const r = read({
      movedEvents: [good.movedEvents, { eventId: 1 }],
      tentativeSeen: [good.tentativeSeen, "x"],
      mealChoices: [good.mealChoices, { date: "hoy", kind: "x" }],
      eventTravel: { ok: { minutes: 5, key: "k" }, bad: { minutes: "5", key: "k" } },
      noTravel: ["zoom", 2],
      notSubjects: ["charla", 1],
      removedSubjects: ["calculo", null],
      applied: [{ id: "a", before: "x" }],
      planHistory: [{ at: "x" }],
    });
    expect(r.data.movedEvents).toEqual([good.movedEvents]);
    expect(r.data.tentativeSeen).toEqual([good.tentativeSeen]);
    expect(r.data.mealChoices).toEqual([good.mealChoices]);
    expect(r.data.eventTravel).toEqual({ ok: { minutes: 5, key: "k" } });
    expect(r.data.noTravel).toEqual(["zoom"]);
    expect(r.data.notSubjects).toEqual(["charla"]);
    expect(r.data.removedSubjects).toEqual(["calculo"]);
    expect(r.data.applied).toEqual([]);
    expect(r.data.planHistory).toEqual([]);
    expect(r.dropped?.length).toBeGreaterThanOrEqual(9);
  });

  it("un extra que no es de la forma (ni lista ni objeto) se descarta entero", () => {
    const r = read({ planHistory: {}, removedSubjects: "x", freeTimeUntil: "mañana" });
    expect(r.data.planHistory).toBeUndefined();
    expect(r.data.removedSubjects).toBeUndefined();
    expect(r.data.freeTimeUntil).toBeUndefined();
    expect(r.dropped).toHaveLength(3);
  });

  it("un respaldo sano no avisa nada", () => {
    const r = read({ calendars: [calendar], noTravel: ["zoom"] });
    expect(r.dropped).toBeUndefined();
  });

  it("lo que no es un extra sigue rechazando el archivo", () => {
    const r = parseBackup(file({ tasks: [{ id: 1 }] }));
    expect(r).toHaveProperty("error");
  });
});
