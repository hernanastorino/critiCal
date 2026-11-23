// «Tu semana tipo» (SPEC §18.1, efecto IKEA): what the user has built so far, as real counts
// that grow with use. Nothing is measured against a goal and nothing is invented.
import type { AppData } from "./model.js";

/** How many materias, routines and places the user has set up. */
export function weekTypeCounts(data: AppData): {
  materias: number;
  rutinas: number;
  lugares: number;
} {
  const rutinas = data.activities.filter((a) => a.kind === "rutina").length;
  return {
    materias: data.activities.length - rutinas,
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
