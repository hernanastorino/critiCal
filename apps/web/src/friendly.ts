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

/**
 * What a card says an option achieves. When the minimums were already reached and only the
 * targets were short, «llegás a todos los mínimos» would say nothing about it. `otherwise`
 * is the text for an option that does not reach every minimum; `minimumsMet` is whether the
 * plan reached them before the option.
 */
export function optionPromise(
  option: { kind: string; result: { feasible: boolean; status: { targetDeficit: number }[] } },
  minimumsMet: boolean,
  otherwise: string,
): string {
  if (!minimumsMet)
    return option.result.feasible ? "Con esto llegás a todos los mínimos." : otherwise;
  if (option.kind === "minimum-only")
    return "Con esto el plan cubre todo lo que queda, aunque no llegues al objetivo.";
  if (option.kind === "use-free-time")
    return option.result.status.every((s) => s.targetDeficit === 0)
      ? "Con esto llegás al objetivo usando tiempo libre."
      : "Con esto sumás tiempo libre al plan, pero el objetivo no se cubre del todo.";
  return option.result.feasible ? "Con esto llegás a todos los mínimos." : otherwise;
}

/** An option that reaches every minimum but those of tasks that fit nowhere anyway. */
export const onlyNoFitLeft = (names: string[]) =>
  `Con esto llegás a todo menos ${names.map((n) => `«${n}»`).join(" y ")}, que no entra${names.length > 1 ? "n" : ""} igual.`;

/** What a task that fits nowhere is: a routine, a materia's weekly hours, or one with a date. */
export type NoFitKind = "routine" | "habit" | "study" | "dated";

/** A task whose minimum does not fit even with the whole time to itself: it is the cause. */
export function noFit(name: string, kind: NoFitKind): string {
  if (kind === "routine")
    return `«${name}» no entra esta semana aunque no hubiera nada más: son más veces de las que caben en los días que quedan. Bajá las veces en Ajustes › Rutinas o elegí «No hacer ${name}».`;
  if (kind === "habit")
    return `«${name}» no entra esta semana aunque no hubiera nada más: son más veces de las que caben en los días que quedan. Bajá las veces en Silos: tocá «${name}» y después Editar. O elegí «No hacer ${name}».`;
  if (kind === "study")
    return `«${name}» no entra esta semana aunque no hubiera nada más: son más horas de las que caben en los días que quedan. Bajá sus horas en Ajustes › Materias o elegí «No hacer ${name}».`;
  return `«${name}» no entra antes de su fecha aunque no hubiera nada más. Cambiá la fecha o el mínimo, o elegí «No hacer ${name}».`;
}

/** Today has nothing left in the plan. */
export const FREE_TODAY = "Hoy no queda nada por hacer: día libre.";

/** After a replan that fits skipped or moved blocks again (Roy celebrates). */
export const REPLANNED_TOAST = "Listo, reacomodé el plan. Bien ahí.";
