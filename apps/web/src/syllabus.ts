// A course syllabus (programa) read by Gemini, checked before the app sees it, and
// turned into tasks once the user confirms the preview.
import { DEFAULTS } from "./calendars.js";
import { type Activity, zonedInstant } from "./engine.js";
import type { AppTask } from "./model.js";

export type AssessmentKind = "parcial" | "entrega" | "presentacion";

export interface Syllabus {
  subject: string;
  units: { title: string; hours: number }[];
  assessments: {
    title: string;
    kind: AssessmentKind;
    /** YYYY-MM-DD, or null when the programa gives no date. */
    date: string | null;
    hours: number;
    /** Titles of the units it covers. */
    units: string[];
    /** How much each covered unit weighs in it, 0–100, by unit title. */
    weights: Record<string, number>;
  }[];
}

/** Gemini's structured-output schema (OpenAPI subset). */
export const SCHEMA = {
  type: "OBJECT",
  properties: {
    subject: { type: "STRING" },
    units: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { title: { type: "STRING" }, hours: { type: "NUMBER" } },
        required: ["title", "hours"],
      },
    },
    assessments: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          kind: { type: "STRING", enum: ["parcial", "entrega", "presentacion"] },
          date: { type: "STRING", nullable: true },
          hours: { type: "NUMBER" },
          units: { type: "ARRAY", items: { type: "STRING" } },
          /** Weight of each unit in the assessment, same order as `units`. */
          weights: { type: "ARRAY", items: { type: "NUMBER" } },
        },
        required: ["title", "kind", "hours", "units"],
      },
    },
  },
  required: ["subject", "units", "assessments"],
} as const;

export function prompt(year: number): string {
  return [
    "Este PDF es el programa de una materia universitaria (Uruguay).",
    "Extraé el nombre de la materia, sus unidades o temas, y las evaluaciones (parciales, exámenes, entregas, trabajos, presentaciones).",
    "Para cada unidad, estimá las horas de estudio personal (fuera de clase) que necesita un estudiante promedio para dominarla.",
    "Para cada evaluación, indicá qué unidades abarca (con el mismo título que en la lista de unidades), las horas de preparación y la fecha si aparece.",
    "En weights, cuánto pesa cada una de esas unidades en la evaluación (0 a 100, en el mismo orden que units): lo que diga el programa (porcentaje o puntos) o, si no lo dice, una estimación según su importancia.",
    `Las fechas van en formato AAAA-MM-DD; si falta el año, es ${year}. Si no hay fecha, usá null. No inventes evaluaciones que el programa no menciona.`,
    "Respondé en español.",
  ].join(" ");
}

const clampHours = (h: unknown) => {
  const n = typeof h === "number" && Number.isFinite(h) ? h : 0;
  return Math.min(200, Math.max(0, Math.round(n * 2) / 2));
};
/** A day that exists (2026-02-31 does not): otherwise the user must enter it. */
function realDate(x: unknown): x is string {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const d = new Date(`${x}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === x;
}

/** Hours typed in the preview: finite, 0 to 200, half-hour steps. */
export function editedHours(v: string): number {
  return clampHours(Number(v.replace(",", ".")));
}

const text = (t: unknown, max = 120) => (typeof t === "string" ? t.trim().slice(0, max) : "");

/** Keeps only well-formed fields, so a creative model cannot break the app. */
export function clean(raw: unknown): Syllabus | null {
  const r = raw as Partial<Record<keyof Syllabus, unknown>> | null;
  if (!r || typeof r !== "object") return null;
  const units = (Array.isArray(r.units) ? r.units : [])
    .map((u) => ({ title: text(u?.title), hours: clampHours(u?.hours) }))
    .filter((u) => u.title)
    // Titles identify units (preview rows, hours by title): keep the first of each.
    .filter((u, i, all) => all.findIndex((x) => x.title === u.title) === i)
    .slice(0, 40);
  const titles = new Set(units.map((u) => u.title));
  const assessments = (Array.isArray(r.assessments) ? r.assessments : [])
    .map((a) => ({
      title: text(a?.title),
      kind: (["parcial", "entrega", "presentacion"].includes(a?.kind)
        ? a.kind
        : "parcial") as AssessmentKind,
      date: realDate(a?.date) ? a.date : null,
      hours: clampHours(a?.hours),
      ...covered(a?.units, a?.weights, titles),
    }))
    .filter((a) => a.title)
    .slice(0, 20);
  const subject = text(r.subject, 80);
  if (!subject && units.length === 0 && assessments.length === 0) return null;
  return { subject: subject || "Materia", units, assessments };
}

/** Same subject ignoring case, accents and spacing, but not punctuation ("C++" is not "C"). */
function sameName(a: string, b: string): boolean {
  const key = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  return key(a) === key(b);
}

export interface PlannedAssessment {
  title: string;
  kind: AssessmentKind;
  date: string;
  /** Units with their study minutes and, if known, their weight in it. */
  units: { title: string; minutes: number; weight?: number }[];
  /** Used when it covers no listed unit. */
  minutes: number;
}

/**
 * The app's tasks for the assessments the user kept: one deliverable each, under the
 * subject's activity (existing by name, or new), with its units to tick off.
 */
export function syllabusTasks(input: {
  subject: string;
  activities: readonly Activity[];
  assessments: readonly PlannedAssessment[];
  timeZone: string;
  newId: () => string;
  color: string;
}): { activity: Activity; isNew: boolean; tasks: AppTask[] } {
  const existing = input.activities.find((a) => sameName(a.name, input.subject));
  const activity: Activity = existing ?? {
    id: input.newId(),
    name: input.subject,
    color: input.color,
    academic: true,
    maxSessionMinutes: 120,
    minBlockMinutes: 60,
  };
  const tasks = input.assessments.map((a): AppTask => {
    const units = a.units.map((u) => ({
      id: input.newId(),
      title: u.title,
      estimateMinutes: u.minutes,
      ...(u.weight !== undefined ? { weight: u.weight } : {}),
    }));
    // Its own hours only without units: kept units define the estimate, even at zero.
    const total = units.length ? units.reduce((s, u) => s + u.estimateMinutes, 0) : a.minutes;
    const d = DEFAULTS[a.kind];
    return {
      id: input.newId(),
      activityId: activity.id,
      title: a.title,
      kind: "deliverable",
      // Exams in the morning; deliveries at the end of the day.
      deadline: zonedInstant(input.timeZone, a.date, a.kind === "entrega" ? 23 * 60 + 59 : 8 * 60),
      estimateMinutes: total,
      minMinutes: Math.round(total * (d.min / d.estimate)),
      priority: d.priority,
      status: "active",
      units,
    };
  });
  return { activity, isNew: !existing, tasks };
}

/**
 * The listed units an assessment covers (each once) and their weights, kept in step:
 * weights come in the same order as the model's unit titles.
 */
function covered(rawUnits: unknown, rawWeights: unknown, titles: Set<string>) {
  const list = Array.isArray(rawUnits) ? rawUnits : [];
  const weightsIn = Array.isArray(rawWeights) ? rawWeights : [];
  const units: string[] = [];
  const weights: Record<string, number> = {};
  list.forEach((t: unknown, i: number) => {
    const title = text(t);
    if (!titles.has(title) || units.includes(title)) return;
    units.push(title);
    // Untrusted: null, "" or [] would read as 0 (a weightless unit, left out first).
    const raw = weightsIn[i];
    const w =
      typeof raw === "number" || (typeof raw === "string" && raw.trim() !== "")
        ? Number(raw)
        : Number.NaN;
    if (Number.isFinite(w) && w >= 0) weights[title] = Math.min(100, Math.round(w));
  });
  return { units, weights };
}
