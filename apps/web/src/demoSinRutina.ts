import { demoData } from "./demo.js";
import type { AppData } from "./model.js";

/**
 * The demo with its Gym as a plain weekly silo (not a routine). Routines live in
 * Ajustes → Rutinas, not in Silos: these tests exercise the weekly silo itself.
 */
export function demoSinRutina(now: number): AppData {
  const d = demoData(now);
  return {
    ...d,
    activities: d.activities.map((a) => (a.kind === "rutina" ? { ...a, kind: undefined } : a)),
  };
}
