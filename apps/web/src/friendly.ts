/**
 * Texts for when something goes wrong (SPEC §18.1): dry and short, no blame, and always
 * the way out. Humor only where it is light (a meal without room, a skipped block);
 * a sync that fails or a deletion is told plainly.
 */

/** After skipping a block: no guilt, and the plan moves on. */
export const SKIPPED_TOAST = "Anotado, sin culpa. Reacomodo lo que falta.";

/** A meal that fits nowhere: it stays where it was, on top of something fixed. */
export const mealNoRoom = (from: string, to: string, at: string) =>
  `Entre las ${from} y las ${to} todo está ocupado por eventos fijos o bloques 📌: ni un bocado de lugar. Quedó a las ${at}, encima de lo que hay. Dejala ahí, tocala en la semana para moverla a cualquier hora, o elegí «Hoy no».`;

/** An option that still does not reach every minimum: say what to do next. */
export const STILL_SHORT = "Con esto todavía faltaría tiempo: sumá otra opción o aflojá un mínimo.";

/** Today has nothing left in the plan. */
export const FREE_TODAY = "Hoy no queda nada por hacer: día libre.";
