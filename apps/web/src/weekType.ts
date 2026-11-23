// «Tu semana tipo» (SPEC §18.1, efecto IKEA): what the user has built so far, as real counts
// that grow with use. Nothing is measured against a goal and nothing is invented.
import type { AppData } from "./model.js";

/** How many materias, routines and places the user has set up. */
export function weekTypeCounts(data: AppData): {
  materias: number;
  rutinas: number;
  lugares: number;
} {
  // Only the routines that still make blocks: a paused, ended or dropped one does not.
  const running = new Set(
    data.tasks
      .filter((t) => t.kind === "habit" && t.status === "active" && !t.paused && !t.endedAt)
      .map((t) => t.activityId),
  );
  const rutinas = data.activities.filter((a) => a.kind === "rutina" && running.has(a.id)).length;
  const routineCount = data.activities.filter((a) => a.kind === "rutina").length;
  return {
    materias: data.activities.length - routineCount,
    rutinas,
    lugares: (data.places ?? []).length,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** «Tu semana tipo: 4 materias, 3 rutinas, 5 lugares»; what is zero is left out, none → null. */
export function weekTypeLine(data: AppData): string | null {
  const c = weekTypeCounts(data);
  const parts = [
    c.materias > 0 && plural(c.materias, "materia", "materias"),
    c.rutinas > 0 && plural(c.rutinas, "rutina", "rutinas"),
    c.lugares > 0 && plural(c.lugares, "lugar", "lugares"),
  ].filter((p): p is string => !!p);
  return parts.length > 0 ? `Tu semana tipo: ${parts.join(", ")}` : null;
}
