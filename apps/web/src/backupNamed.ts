// What the database (or the app) could not take from a backup file, said in Spanish.
// Each check is a list of rules over one kind of record: the first rule a record breaks
// gives the message. Nothing here changes the data; `backup.ts` runs it before its own gate.
import {
  BACKUP_MINUTES_MAX,
  BACKUP_TEXT_MAX,
  isRealDate,
  SESSIONS_PER_WEEK_MAX,
} from "./limits.js";

export type Rec = Record<string, unknown>;
export type Ok = (v: unknown, x?: Rec) => boolean;
/** `[key, valid, what is wrong when it is not]` */
export type Test = [key: string, ok: Ok, ...say: string[]];
export type Rule = [key: string, ok: Ok, say: string];
type Check = (d: Rec) => string | null;

export const isRec = (x: unknown): x is Rec => !!x && typeof x === "object" && !Array.isArray(x);
export const list = (x: unknown): Rec[] => (Array.isArray(x) ? x.filter(isRec) : []);
export const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const int =
  (lo: number, hi: number): Ok =>
  (v) =>
    Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
export const opt =
  (ok: Ok): Ok =>
  (v, x) =>
    v === undefined || ok(v, x);
export const oneOf =
  (...xs: string[]): Ok =>
  (v) =>
    xs.includes(v as string);
export const str: Ok = (v) => typeof v === "string" && v.length > 0;
export const text: Ok = (v) => typeof v === "string";
export const bool: Ok = (v) => typeof v === "boolean";
/** A name or title: something to read, not longer than a backup takes. */
export const name: Ok = (v) =>
  typeof v === "string" && v.trim() !== "" && v.length <= BACKUP_TEXT_MAX;
/** An instant the database's timestamps hold (years 1900 to 9999). */
export const instant: Ok = (v) =>
  num(v) && v >= Date.UTC(1900, 0, 1) && v <= Date.UTC(9999, 11, 31);
export const strings: Ok = (v) => Array.isArray(v) && v.every((s) => typeof s === "string");
export const shortStrings: Ok = (v) =>
  Array.isArray(v) && v.every((s) => typeof s === "string" && s.length <= BACKUP_TEXT_MAX);
const MEALS = ["desayuno", "almuerzo", "merienda", "cena"];
const STATUSES = ["done", "missed", "partial", "retired"];

function broken(who: string, x: Rec, rules: Rule[]): string | null {
  const bad = rules.find(([key, ok]) => !ok(Reflect.get(x, key), x));
  return bad ? `${who} ${bad[2]}.` : null;
}

function firstBroken(xs: Rec[], who: (x: Rec) => string, rules: Rule[]): string | null {
  for (const x of xs) {
    const found = broken(who(x), x, rules);
    if (found) return found;
  }
  return null;
}

const called = (x: Rec, key: string, fallback: string) => {
  const v = Reflect.get(x, key);
  return typeof v === "string" && v ? `«${v.slice(0, 40)}»` : fallback;
};

const settingsProblem: Check = (d) => {
  const s = d.settings;
  if (!isRec(s)) return null;
  const rules: Rule[] = [
    [
      "timezone",
      (v) => typeof v === "string" && v.length >= 1 && v.length <= 64,
      "la zona horaria no es válida",
    ],
    ["slotMinutes", oneOf15, "los bloques tienen que ser de 15, 30 o 60 minutos"],
    ["maxActivitiesPerDay", int(1, 50), "las materias por día tienen que ser un entero de 1 a 50"],
    [
      "warnSlackMinutes",
      int(0, 10_080),
      "el aviso de margen tiene que ser un entero de 0 a 10080 minutos",
    ],
  ];
  const found = broken("Ajustes:", s, rules);
  if (found) return found;
  return JSON.stringify(s).length > 65_536
    ? "Los ajustes del respaldo son demasiado grandes."
    : null;
};
function oneOf15(v: unknown) {
  return v === 15 || v === 30 || v === 60;
}

const hoursRange = (r: unknown) =>
  isRec(r) &&
  int(0, 1440)(r.start, r) &&
  int(0, 1440)(r.end, r) &&
  (r.end as number) > (r.start as number);

/** A routine's valid hours: a range for every day and ranges (or null) for weekdays 0 to 6. */
export const validHoursOk: Ok = (v) =>
  isRec(v) &&
  Object.keys(v).every((k) => k === "all" || k === "days") &&
  (v.all === undefined || hoursRange(v.all)) &&
  (v.days === undefined ||
    (isRec(v.days) &&
      Object.entries(v.days).every(
        // null: «No ese día».
        ([k, r]) => /^[0-6]$/.test(k) && (r === null || hoursRange(r)),
      )));

const activityRules = (): Rule[] => [
  [
    "validHours",
    opt(validHoursOk),
    "tiene un horario válido que no son rangos de 0 a 1440 minutos, con el fin después del inicio",
  ],
  ["id", str, "tiene un identificador que no es texto"],
  ["name", name, `tiene un nombre vacío o de más de ${BACKUP_TEXT_MAX} caracteres`],
  ["kind", opt(oneOf("materia", "rutina")), "tiene un tipo que no es materia ni rutina"],
  [
    "maxSessionMinutes",
    int(1, 1440),
    "tiene una sesión máxima que no son minutos enteros de 1 a 1440",
  ],
  [
    "minBlockMinutes",
    int(1, 1440),
    "tiene un bloque mínimo que no son minutos enteros de 1 a 1440",
  ],
  [
    "preferred",
    opt(
      (p) =>
        isRec(p) &&
        int(0, 1440)(p.start, p) &&
        int(0, 1440)(p.end, p) &&
        (p.end as number) > (p.start as number),
    ),
    "tiene un horario preferido que no son minutos enteros de 0 a 1440, con el fin después del inicio",
  ],
  [
    "studyMinutes",
    opt(int(1, 1440)),
    "tiene minutos de estudio entre descansos que no son un entero de 1 a 1440",
  ],
  ["breakMinutes", opt(int(0, 1440)), "tiene minutos de descanso que no son un entero de 0 a 1440"],
  [
    "aliases",
    opt(shortStrings),
    `tiene alias que no son texto de hasta ${BACKUP_TEXT_MAX} caracteres`,
  ],
];

const activitiesProblem: Check = (d) =>
  firstBroken(
    list(d.activities),
    (a) => `La materia ${called(a, "name", "sin nombre")}`,
    activityRules(),
  );

const unitRules = (): Rule[] => [
  ["id", str, "tiene una parte con un identificador que no es texto"],
  [
    "estimateMinutes",
    (v) => Number.isInteger(v),
    "tiene una parte con minutos que no son un número entero",
  ],
  ["weight", opt(int(0, 100)), "tiene una parte con un peso que no es un entero de 0 a 100"],
  ["doneAt", opt(instant), "tiene una parte con una fecha de hecho que no es válida"],
  ["doneByHand", opt(bool), "tiene una parte con un dato de «marcada a mano» que no es sí o no"],
];

const taskRules = (): Rule[] => [
  ["id", str, "tiene un identificador que no es texto"],
  ["activityId", str, "tiene una materia con un identificador que no es texto"],
  ["title", name, `tiene el título vacío o de más de ${BACKUP_TEXT_MAX} caracteres`],
  ["kind", oneOf("deliverable", "habit"), "tiene un tipo que no es entrega ni hábito"],
  [
    "status",
    oneOf("active", "done", "dropped"),
    "tiene un estado que no es activa, hecha ni descartada",
  ],
  ["priority", int(1, 3), "tiene una prioridad que no es 1, 2 ni 3"],
  [
    "estimateMinutes",
    int(0, BACKUP_MINUTES_MAX),
    `tiene minutos estimados que no son enteros de 0 a ${BACKUP_MINUTES_MAX}`,
  ],
  [
    "minMinutes",
    int(0, BACKUP_MINUTES_MAX),
    `tiene un mínimo que no son minutos enteros de 0 a ${BACKUP_MINUTES_MAX}`,
  ],
  [
    "sessionsPerWeek",
    opt(int(1, SESSIONS_PER_WEEK_MAX)),
    `tiene sesiones por semana que no son un entero de 1 a ${SESSIONS_PER_WEEK_MAX}`,
  ],
  ["sessionMinutes", opt(int(1, 1440)), "tiene una sesión que no son minutos enteros de 1 a 1440"],
  [
    "maxPerDayMinutes",
    opt(int(1, 1440)),
    "tiene un máximo por día que no son minutos enteros de 1 a 1440",
  ],
  [
    "sourceRole",
    opt(oneOf("parcial", "entrega", "presentacion")),
    "tiene un origen que no es parcial, entrega ni presentación",
  ],
  ["sourceEventId", opt(text), "tiene un evento de origen que no es texto"],
  ["skipUntil", opt(instant), "tiene una fecha de pausa que no es válida"],
  ["endedAt", opt(instant), "tiene una fecha de fin que no es válida"],
  ["autoDroppedAt", opt(instant), "tiene una fecha de descarte que no es válida"],
  ["createdAt", opt(instant), "tiene una fecha de creación que no es válida"],
  ["units", (v) => Array.isArray(v), "no tiene la lista de partes"],
];

const taskIssue = (t: Rec): string | null =>
  broken(`La tarea ${called(t, "title", "sin título")}`, t, taskRules()) ??
  firstBroken(list(t.units), () => `La tarea ${called(t, "title", "sin título")}`, unitRules());

const tasksProblem: Check = (d) => {
  for (const t of list(d.tasks)) {
    const found = taskIssue(t);
    if (found) return found;
  }
  return null;
};

const checkInRules = (): Rule[] => [
  ["id", str, "tiene un identificador que no es texto"],
  ["blockId", str, "no dice de qué bloque es"],
  ["taskId", str, "tiene una tarea con un identificador que no es texto"],
  ["status", oneOf(...STATUSES), "tiene un estado que no es hecho, perdido ni parcial"],
  ["minutesDone", int(0, 100_000_000), "tiene minutos que no son un entero desde 0"],
  [
    "unitIds",
    (v) => Array.isArray(v) && v.every((u) => str(u)),
    "tiene partes con identificadores que no son texto",
  ],
  ["createdAt", instant, "tiene una fecha que no es válida"],
  ["origin", opt(oneOf("undo")), "tiene un origen que no es «undo»"],
];

const checkInsProblem: Check = (d) =>
  firstBroken(list(d.checkIns), () => "Un registro de tareas", checkInRules());

const blockRules = (): Rule[] => [
  ["taskId", str, "tiene una tarea con un identificador que no es texto"],
  ["level", opt(oneOf("ok", "warn", "critical")), "tiene un nivel que no es ok, warn ni critical"],
  ["soft", opt(bool), "tiene un dato de «libre» que no es sí o no"],
];

const planProblem: Check = (d) =>
  firstBroken(list(d.plan), () => "Un bloque del plan", blockRules());

const placeRules = (): Rule[] => [
  ["id", str, "tiene un identificador que no es texto"],
  ["name", name, `tiene un nombre vacío o de más de ${BACKUP_TEXT_MAX} caracteres`],
  ["aliases", shortStrings, `tiene alias que no son texto de hasta ${BACKUP_TEXT_MAX} caracteres`],
  ["address", opt(text), "tiene una dirección que no es texto"],
  ["isHome", opt(bool), "tiene un dato de «es mi casa» que no es sí o no"],
  ["travelMode", opt(oneOf("car", "bus")), "tiene una forma de llegar que no es auto ni ómnibus"],
];

export const arrayOf =
  (ok: Ok): Ok =>
  (v, x) =>
    Array.isArray(v) && v.every((e) => ok(e, x));
export const recordOf =
  (ok: Ok): Ok =>
  (v, x) =>
    isRec(v) && Object.values(v).every((e) => ok(e, x));
export const allOf = (x: Rec, tests: Test[]) =>
  tests.every(([key, ok]) => ok(Reflect.get(x, key), x));
export const shape =
  (tests: Test[]): Ok =>
  (v) =>
    isRec(v) && allOf(v, tests);
export const listOf = (tests: Test[]): Ok => arrayOf(shape(tests));
export const dupes = (xs: unknown[]) => new Set(xs).size !== xs.length;

const placesProblem: Check = (d) => {
  const places = list(d.places);
  const found = firstBroken(
    places,
    (p) => `El lugar ${called(p, "name", "sin nombre")}`,
    placeRules(),
  );
  if (found) return found;
  if (dupes(places.map((p) => p.id))) return "El respaldo tiene lugares repetidos.";
  const known = new Set(places.map((p) => p.id));
  const trips = list(d.travelTimes);
  const lost = trips.some((t) => !known.has(t.from) || !known.has(t.to));
  if (lost) return "Un traslado apunta a un lugar que no está en el respaldo.";
  if (dupes(trips.map((t) => `${String(t.from)}>${String(t.to)}`)))
    return "El respaldo tiene un traslado repetido.";
  return null;
};

const mealTests: Test[] = [
  ["kind", oneOf(...MEALS)],
  ["start", opt(int(0, 2880))],
  ["skip", opt(bool)],
];
const mealChoice: Ok = (v) => shape(mealTests)(v);

const overridesProblem: Check = (d) => {
  const days = list(d.overrides);
  if (dupes(days.map((o) => o.date))) return "El respaldo tiene un día de ajuste repetido.";
  const bad = days.some(
    (o) => !opt((m) => Array.isArray(m) && m.every((c) => mealChoice(c)))(o.meals, o),
  );
  return bad ? "Un ajuste de día tiene comidas que no son válidas." : null;
};

const unitsProblem: Check = (d) => {
  // Repeated inside one task has its own message (`taskProblem`).
  const ids = list(d.tasks).flatMap((t) => [...new Set(list(t.units).map((u) => u.id))]);
  return dupes(ids) ? "El respaldo tiene partes repetidas entre tareas." : null;
};

// ---- Data kept as loose JSON in the settings row: not rejected by the database, but the
// ---- screens read it, so a wrong shape would break them.

export const looseBlockTests: Test[] = [
  ["id", str],
  ["taskId", str],
  ["start", instant],
  ["end", instant],
];
export const looseProposalTests: Test[] = [
  ["id", str],
  ["plan", listOf(looseBlockTests)],
];
const movedTests: Test[] = [
  ["eventId", str],
  ["from", instant],
  ["start", instant],
  ["end", instant],
];
const startAfterOk: Ok = (v) =>
  isRec(v) && [isRealDate(v.date), int(0, 365)(v.daysBefore), v.now === true].some(Boolean);
const statuses = oneOf("active", "done", "dropped");
const roles = oneOf("busy", "ignore", "parcial", "entrega", "presentacion", "clases", "flexible");

const calendarTests: Test[] = [
  ["id", str],
  ["source", oneOf("google", "icloud")],
  ["externalId", str],
  ["id", (v, x) => v === `${String(x?.source)}:${String(x?.externalId)}`],
  ["name", name],
  ["color", opt(text)],
  ["role", opt(roles)],
];

/** A task of the undo history: what the screens read of it when it is put back. */
const oldTask: Ok = (t) => isRec(t) && taskIssue(t) === null;

const decisionTests: Test[] = [
  ["id", str],
  ["label", text],
  ["at", instant],
  ["before", arrayOf(oldTask)],
  ["dropped", opt(strings)],
  ["after", opt(recordOf(statuses))],
  ["afterMinutes", opt(recordOf((m) => isRec(m) && num(m.min) && num(m.estimate)))],
  ["freeTimeUntil", opt(instant)],
  ["addedBlocks", opt(strings)],
  ["skippedUnits", opt(strings)],
  ["movedEventId", opt(text)],
  ["previousMove", opt(shape(movedTests))],
  ["move", opt(shape(movedTests))],
  ["skipUntil", opt(recordOf(num))],
  ["startAfter", opt(recordOf(startAfterOk))],
];

const mealDayTests: Test[] = [["date", isRealDate], ...mealTests];
const versionTests: Test[] = [
  ["at", instant],
  ["label", text],
  ["pins", listOf(looseBlockTests)],
  ["today", listOf(looseBlockTests)],
  ["overrides", listOf([["date", isRealDate]])],
  ["proposals", listOf(looseProposalTests)],
  ["mealChoices", opt(listOf(mealDayTests))],
  ["freeTimeUntil", opt(instant)],
  ["relaxContextUntil", opt(instant)],
  ["tentativeHoldUntil", opt(instant)],
];
const tentativeTests: Test[] = [
  ["id", str],
  ["title", text],
  ["start", instant],
  ["end", instant],
];
const travelMinutesTests: Test[] = [
  ["minutes", int(0, 1440)],
  ["key", text],
];

/** How an optional top-level key is read: a list or an object of entries, or one value. */
type Kind = "list" | "record" | "value";
/** Optional top-level keys: `[key, kind, valid entry, what it is, for the notice]`. */
type Extra = [key: string, kind: Kind, ok: Ok, label: string];

const extras: Extra[] = [
  ["calendars", "list", shape(calendarTests), "calendarios"],
  ["applied", "list", shape(decisionTests), "decisiones que se pueden deshacer"],
  ["planHistory", "list", shape(versionTests), "versiones del historial del plan"],
  ["eventTravel", "record", shape(travelMinutesTests), "traslados guardados de eventos"],
  ["tripModes", "record", oneOf("car", "bus"), "formas de llegar elegidas para un evento"],
  ["mealChoices", "list", shape(mealDayTests), "comidas cambiadas"],
  ["movedEvents", "list", shape(movedTests), "eventos movidos"],
  ["tentativeSeen", "list", shape(tentativeTests), "eventos tentativos"],
  ["noTravel", "list", text, "lugares sin traslado"],
  ["notSubjects", "list", text, "clases que no son materia"],
  ["removedSubjects", "list", text, "materias eliminadas"],
  ["freeTimeUntil", "value", instant, "tiempo libre permitido"],
  ["relaxContextUntil", "value", instant, "permiso de cambiar de materia"],
  ["tentativeHoldUntil", "value", instant, "espera por un plan B"],
];

/** What stays of an optional value, and how many entries went (`null`: all of it, it had the wrong kind). */
function trimmed(kind: Kind, v: unknown, ok: Ok, d: Rec): { value?: unknown; lost: number | null } {
  if (kind === "value") return ok(v, d) ? { value: v, lost: 0 } : { lost: null };
  if (kind === "record") {
    if (!isRec(v)) return { lost: null };
    const kept = Object.entries(v).filter(([, e]) => ok(e, d));
    return { value: Object.fromEntries(kept), lost: Object.keys(v).length - kept.length };
  }
  if (!Array.isArray(v)) return { lost: null };
  const kept = v.filter((e) => ok(e, d));
  return { value: kept, lost: v.length - kept.length };
}

/**
 * The file without the optional data the screens could not read, and what was left out
 * (for the notice). Only the bad entry goes: the rest of the list stays, and a key of the
 * wrong kind altogether goes whole. Nothing here rejects the file.
 */
export function dropBadExtras(d: Rec): { data: Rec; dropped: string[] } {
  const data: Rec = { ...d };
  const dropped: string[] = [];
  for (const [key, kind, ok, label] of extras) {
    const v = Reflect.get(data, key);
    if (v === undefined) continue;
    const { value, lost } = trimmed(kind, v, ok, data);
    if (lost === 0) continue;
    if (lost === null) Reflect.deleteProperty(data, key);
    else Reflect.set(data, key, value);
    dropped.push(lost === null ? label : `${label} (${lost})`);
  }
  return { data, dropped };
}

const eventRules: Rule[] = [
  ["location", opt(text), "tiene una ubicación que no es texto"],
  ["link", opt(text), "tiene un enlace que no es texto"],
  ["calendarId", opt(text), "tiene un calendario que no es texto"],
  ["source", opt(oneOf("google", "icloud", "demo")), "tiene un origen desconocido"],
  ["allDay", opt(bool), "tiene un dato de «todo el día» que no es sí o no"],
  ["tentative", opt(bool), "tiene un dato de «tentativo» que no es sí o no"],
];

const eventsProblem: Check = (d) =>
  firstBroken(list(d.events), (e) => `El evento ${called(e, "title", "sin título")}`, eventRules);

const CHECKS: Check[] = [
  settingsProblem,
  activitiesProblem,
  tasksProblem,
  unitsProblem,
  checkInsProblem,
  planProblem,
  placesProblem,
  overridesProblem,
  eventsProblem,
];

/** The first thing in the file the database or the screens could not take, said for the user, or null. */
export function backupProblem(d: Rec): string | null {
  for (const check of CHECKS) {
    const found = check(d);
    if (found) return found;
  }
  return null;
}
