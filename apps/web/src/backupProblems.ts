// What the database (or the app) could not take from a backup file, said in Spanish.
// Each check is a list of rules over one kind of record: the first rule a record breaks
// gives the message. Nothing here changes the data; `backup.ts` runs it before its own gate.
import {
  BACKUP_MINUTES_MAX,
  BACKUP_TEXT_MAX,
  isRealDate,
  isUuid,
  SESSIONS_PER_WEEK_MAX,
} from "./limits.js";

type Rec = Record<string, unknown>;
type Ok = (v: unknown, x?: Rec) => boolean;
/** `[key, valid, what is wrong when it is not]` */
type Rule = [key: string, ok: Ok, say: string];
type Check = (d: Rec, strict: boolean) => string | null;

const isRec = (x: unknown): x is Rec => !!x && typeof x === "object" && !Array.isArray(x);
const list = (x: unknown): Rec[] => (Array.isArray(x) ? x.filter(isRec) : []);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const int =
  (lo: number, hi: number): Ok =>
  (v) =>
    Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const opt =
  (ok: Ok): Ok =>
  (v, x) =>
    v === undefined || ok(v, x);
const oneOf =
  (...xs: string[]): Ok =>
  (v) =>
    xs.includes(v as string);
const str: Ok = (v) => typeof v === "string" && v.length > 0;
const text: Ok = (v) => typeof v === "string";
const bool: Ok = (v) => typeof v === "boolean";
/** A name or title: something to read, not longer than a backup takes. */
const name: Ok = (v) => typeof v === "string" && v.trim() !== "" && v.length <= BACKUP_TEXT_MAX;
/** An instant the database's timestamps hold (years 1900 to 9999). */
const instant: Ok = (v) => num(v) && v >= Date.UTC(1900, 0, 1) && v <= Date.UTC(9999, 11, 31);
const strings: Ok = (v) => Array.isArray(v) && v.every((s) => typeof s === "string");
const shortStrings: Ok = (v) =>
  Array.isArray(v) && v.every((s) => typeof s === "string" && s.length <= BACKUP_TEXT_MAX);
const MEALS = ["desayuno", "almuerzo", "merienda", "cena"];
const STATUSES = ["done", "missed", "partial"];

/** The id rule: a uuid where the database stores a uuid, any text otherwise (the demo). */
const id = (strict: boolean): Ok => (strict ? (v) => isUuid(v) : str);

function broken(who: string, x: Rec, rules: Rule[]): string | null {
  const bad = rules.find(([key, ok]) => !ok(x[key], x));
  return bad ? `${who} ${bad[2]}.` : null;
}

function firstBroken(xs: Rec[], who: (x: Rec) => string, rules: Rule[]): string | null {
  for (const x of xs) {
    const found = broken(who(x), x, rules);
    if (found) return found;
  }
  return null;
}

const called = (x: Rec, key: string, fallback: string) =>
  typeof x[key] === "string" && x[key] ? `«${(x[key] as string).slice(0, 40)}»` : fallback;

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

const activityRules = (strict: boolean): Rule[] => [
  ["id", id(strict), "tiene un identificador que no sirve para tu cuenta"],
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

const activitiesProblem: Check = (d, strict) =>
  firstBroken(
    list(d.activities),
    (a) => `La materia ${called(a, "name", "sin nombre")}`,
    activityRules(strict),
  );

const unitRules = (strict: boolean): Rule[] => [
  ["id", id(strict), "tiene una parte con un identificador que no sirve para tu cuenta"],
  [
    "estimateMinutes",
    (v) => Number.isInteger(v),
    "tiene una parte con minutos que no son un número entero",
  ],
  ["weight", opt(int(0, 100)), "tiene una parte con un peso que no es un entero de 0 a 100"],
  ["doneAt", opt(instant), "tiene una parte con una fecha de hecho que no es válida"],
];

const taskRules = (strict: boolean): Rule[] => [
  ["id", id(strict), "tiene un identificador que no sirve para tu cuenta"],
  ["activityId", id(strict), "tiene una materia con un identificador que no sirve para tu cuenta"],
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
  ["units", (v) => Array.isArray(v), "no tiene la lista de partes"],
];

const taskIssue = (t: Rec, strict: boolean): string | null =>
  broken(`La tarea ${called(t, "title", "sin título")}`, t, taskRules(strict)) ??
  firstBroken(
    list(t.units),
    () => `La tarea ${called(t, "title", "sin título")}`,
    unitRules(strict),
  );

const tasksProblem: Check = (d, strict) => {
  for (const t of list(d.tasks)) {
    const found = taskIssue(t, strict);
    if (found) return found;
  }
  return null;
};

const checkInRules = (strict: boolean): Rule[] => [
  ["id", id(strict), "tiene un identificador que no sirve para tu cuenta"],
  ["blockId", str, "no dice de qué bloque es"],
  ["taskId", id(strict), "tiene una tarea con un identificador que no sirve para tu cuenta"],
  ["status", oneOf(...STATUSES), "tiene un estado que no es hecho, perdido ni parcial"],
  ["minutesDone", int(0, 100_000_000), "tiene minutos que no son un entero desde 0"],
  [
    "unitIds",
    (v) => Array.isArray(v) && v.every((u) => id(strict)(u, {})),
    "tiene partes con identificadores que no sirven para tu cuenta",
  ],
  ["createdAt", instant, "tiene una fecha que no es válida"],
];

const checkInsProblem: Check = (d, strict) =>
  firstBroken(list(d.checkIns), () => "Un registro de tareas", checkInRules(strict));

const blockRules = (strict: boolean): Rule[] => [
  ["taskId", id(strict), "tiene una tarea con un identificador que no sirve para tu cuenta"],
  ["level", opt(oneOf("ok", "warn", "critical")), "tiene un nivel que no es ok, warn ni critical"],
  ["soft", opt(bool), "tiene un dato de «libre» que no es sí o no"],
];

const planProblem: Check = (d, strict) =>
  firstBroken(list(d.plan), () => "Un bloque del plan", blockRules(strict));

const placeRules = (strict: boolean): Rule[] => [
  ["id", id(strict), "tiene un identificador que no sirve para tu cuenta"],
  ["name", name, `tiene un nombre vacío o de más de ${BACKUP_TEXT_MAX} caracteres`],
  ["aliases", shortStrings, `tiene alias que no son texto de hasta ${BACKUP_TEXT_MAX} caracteres`],
  ["address", opt(text), "tiene una dirección que no es texto"],
  ["isHome", opt(bool), "tiene un dato de «es mi casa» que no es sí o no"],
];

const dupes = (xs: unknown[]) => new Set(xs).size !== xs.length;

const placesProblem: Check = (d, strict) => {
  const places = list(d.places);
  const found = firstBroken(
    places,
    (p) => `El lugar ${called(p, "name", "sin nombre")}`,
    placeRules(strict),
  );
  if (found) return found;
  if (dupes(places.map((p) => p.id))) return "El respaldo tiene lugares repetidos.";
  const known = new Set(places.map((p) => p.id));
  const trips = list(d.travelTimes);
  const lost = trips.some((t) => !known.has(t.from) || !known.has(t.to));
  if (lost) return "Un traslado apunta a un lugar que no está en el respaldo.";
  if (dupes(trips.map((t) => `${t.from}>${t.to}`)))
    return "El respaldo tiene un traslado repetido.";
  return null;
};

const mealChoice: Ok = (v) =>
  isRec(v) && oneOf(...MEALS)(v.kind, v) && opt(int(0, 2880))(v.start, v) && opt(bool)(v.skip, v);

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

const block: Ok = (v) =>
  isRec(v) && str(v.id) && str(v.taskId) && instant(v.start) && instant(v.end);
const proposalOk: Ok = (v) =>
  isRec(v) && str(v.id) && Array.isArray(v.plan) && v.plan.every((b) => block(b));
const dayOverride: Ok = (v) => isRec(v) && isRealDate(v.date);
const moved: Ok = (v) =>
  isRec(v) && str(v.eventId) && instant(v.from) && instant(v.start) && instant(v.end);
const arrayOf =
  (ok: Ok): Ok =>
  (v, x) =>
    Array.isArray(v) && v.every((e) => ok(e, x));
const recordOf =
  (ok: Ok): Ok =>
  (v, x) =>
    isRec(v) && Object.values(v).every((e) => ok(e, x));
const startAfter: Ok = (v) =>
  isRec(v) && (isRealDate(v.date) || int(0, 365)(v.daysBefore, v) || v.now === true);

const calendarOk: Ok = (c) =>
  isRec(c) &&
  str(c.id) &&
  oneOf("google", "icloud")(c.source, c) &&
  str(c.externalId) &&
  c.id === `${c.source}:${c.externalId}` &&
  name(c.name, c) &&
  opt(text)(c.color, c) &&
  opt(oneOf("busy", "ignore", "parcial", "entrega", "presentacion", "clases", "flexible"))(
    c.role,
    c,
  );

/** A task of the undo history: what the screens read of it when it is put back. */
const oldTask: Ok = (t) => isRec(t) && taskIssue(t, false) === null && Array.isArray(t.units);

const decisionOk: Ok = (a) =>
  isRec(a) &&
  str(a.id) &&
  text(a.label, a) &&
  instant(a.at) &&
  arrayOf(oldTask)(a.before, a) &&
  opt(strings)(a.dropped, a) &&
  opt(recordOf(oneOf("active", "done", "dropped")))(a.after, a) &&
  opt(recordOf((m) => isRec(m) && num(m.min) && num(m.estimate)))(a.afterMinutes, a) &&
  opt(instant)(a.freeTimeUntil, a) &&
  opt(strings)(a.addedBlocks, a) &&
  opt(strings)(a.skippedUnits, a) &&
  opt(text)(a.movedEventId, a) &&
  opt(moved)(a.previousMove, a) &&
  opt(moved)(a.move, a) &&
  opt(recordOf(num))(a.skipUntil, a) &&
  opt(recordOf(startAfter))(a.startAfter, a);

const versionOk: Ok = (v) =>
  isRec(v) &&
  instant(v.at) &&
  text(v.label, v) &&
  arrayOf(block)(v.pins, v) &&
  arrayOf(block)(v.today, v) &&
  arrayOf(dayOverride)(v.overrides, v) &&
  arrayOf(proposalOk)(v.proposals, v) &&
  opt(arrayOf(isMealDay))(v.mealChoices, v) &&
  opt(instant)(v.freeTimeUntil, v) &&
  opt(instant)(v.relaxContextUntil, v) &&
  opt(instant)(v.tentativeHoldUntil, v);

function isMealDay(v: unknown) {
  return isRec(v) && isRealDate(v.date) && mealChoice(v, v);
}

/** Optional top-level keys: `[key, valid, message]`. */
const extras: Rule[] = [
  ["calendars", opt(arrayOf(calendarOk)), "Los calendarios del respaldo no son válidos"],
  [
    "applied",
    opt(arrayOf(decisionOk)),
    "Las decisiones que se pueden deshacer del respaldo no son válidas",
  ],
  ["planHistory", opt(arrayOf(versionOk)), "El historial del plan del respaldo no es válido"],
  [
    "eventTravel",
    opt(recordOf((t) => isRec(t) && int(0, 1440)(t.minutes, t) && text(t.key, t))),
    "Los traslados guardados de eventos del respaldo no son válidos",
  ],
  ["mealChoices", opt(arrayOf(isMealDay)), "Las comidas cambiadas del respaldo no son válidas"],
  ["movedEvents", opt(arrayOf(moved)), "Los eventos movidos del respaldo no son válidos"],
  [
    "tentativeSeen",
    opt(
      arrayOf(
        (t) => isRec(t) && str(t.id) && text(t.title, t) && instant(t.start) && instant(t.end),
      ),
    ),
    "Los eventos tentativos del respaldo no son válidos",
  ],
  ["noTravel", opt(strings), "La lista de lugares sin traslado del respaldo no es válida"],
  ["notSubjects", opt(strings), "La lista de clases que no son materia del respaldo no es válida"],
  ["removedSubjects", opt(strings), "La lista de materias eliminadas del respaldo no es válida"],
  ["freeTimeUntil", opt(instant), "El tiempo libre permitido del respaldo no es válido"],
  ["relaxContextUntil", opt(instant), "El permiso de cambiar de materia del respaldo no es válido"],
  ["tentativeHoldUntil", opt(instant), "La espera por un plan B del respaldo no es válida"],
];

const extrasProblem: Check = (d) => {
  const bad = extras.find(([key, ok]) => !ok(d[key], d));
  return bad ? `${bad[2]}.` : null;
};

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
  extrasProblem,
];

/**
 * The first thing in the file the database or the screens could not take, said for the
 * user, or null. `strict`: the ids go to a database that stores them as uuids.
 */
export function backupProblem(d: Rec, strict: boolean): string | null {
  for (const check of CHECKS) {
    const found = check(d, strict);
    if (found) return found;
  }
  return null;
}
