/**
 * Texts for when something goes wrong (SPEC §18.1): dry and short, no blame, and always
 * the way out. Humor only where it is light (a meal without room, a skipped block);
 * a sync that fails or a deletion is told plainly.
 */

import { joinList } from "./engine.js";
import { hours } from "./format.js";

/** After skipping a block: no guilt, and the plan moves on. */
export const SKIPPED_TOAST = "Anotado, sin culpa. Reacomodo lo que falta.";

/** A meal that fits nowhere: it stays where it was, on top of something fixed. */
export const mealNoRoom = (at: string) =>
  `Todo ocupado cerca. Quedó a las ${at}, encima de lo fijo.`;

/** An option that still does not reach every minimum: say what to do next. */
export const STILL_SHORT = "Con esto todavía faltaría tiempo: sumá otra opción o aflojá un mínimo.";

/**
 * What a card says an option achieves. When the minimums were already reached and only the
 * targets were short, «llegás a todos los mínimos» would say nothing about it. `otherwise`
 * is the text for an option that does not reach every minimum; `minimumsMet` is whether the
 * plan reached them before the option.
 */
export function optionPromise(
  option: {
    kind: string;
    label?: string;
    result: { feasible: boolean; status: { targetDeficit: number }[] };
  },
  minimumsMet: boolean,
  otherwise: string,
): string {
  // «Un poco de todo» cuts every minimum: it never reaches the ones the tasks had (§5.6).
  if (option.kind === "proportional") {
    const share = option.label?.match(/(\d+) %/)?.at(1);
    return option.result.feasible && share
      ? `Con esto cubrís el ${share} % de cada mínimo, no todo.`
      : otherwise;
  }
  if (!minimumsMet) {
    if (!option.result.feasible) return otherwise;
    // Free time is lent until the end of the week: it is not what makes it last longer.
    return option.kind === "use-free-time"
      ? "Con esto llegás a todos los mínimos usando tu tiempo libre hasta el fin de esta semana."
      : "Con esto llegás a todos los mínimos.";
  }
  if (option.kind === "minimum-only")
    return "Con esto el plan cubre todo lo que queda, aunque no llegues al objetivo.";
  if (option.kind === "use-free-time")
    return option.result.status.every((s) => s.targetDeficit === 0)
      ? "Con esto llegás al objetivo usando tiempo libre."
      : "Con esto sumás tiempo libre al plan, pero el objetivo no se cubre del todo.";
  return option.result.feasible ? "Con esto llegás a todos los mínimos." : otherwise;
}

/** An option's title: free time «para llegar» does not promise it when the forecast leaves something out. */
export function optionTitle(option: {
  kind: string;
  label: string;
  result: { feasible: boolean };
}): string {
  return option.kind === "use-free-time" && !option.result.feasible
    ? option.label.replace(/ para llegar$/, "")
    : option.label;
}

/** An option that reaches every minimum but those of tasks that fit nowhere anyway. */
export const onlyNoFitLeft = (names: string[]) =>
  `Con esto llegás a todo menos ${joinList(names.map((n) => `«${n}»`))}, que no entra${names.length > 1 ? "n" : ""} igual.`;

/**
 * The line of an option card. `noFitLeft` are the tasks that fit nowhere and stay short
 * with it (null when others do too, or none): then it never says «llegás» to the minimums.
 */
export function optionLine(
  option: Parameters<typeof optionPromise>[0],
  minimumsMet: boolean,
  noFitLeft: string[] | null,
): string {
  return noFitLeft ? onlyNoFitLeft(noFitLeft) : optionPromise(option, minimumsMet, STILL_SHORT);
}

/** What a task that fits nowhere is: a routine, a materia's weekly hours, or one with a date. */
export type NoFitKind = "routine" | "hours" | "habit" | "study" | "dated";

/** A task whose minimum does not fit even with the whole time to itself: it is the cause. */
export function noFit(name: string, kind: NoFitKind): string {
  if (kind === "routine")
    return `«${name}» no entra esta semana aunque no hubiera nada más: son más veces de las que caben en los días que quedan. Bajá las veces en Ajustes › Rutinas o elegí «No hacer ${name}».`;
  if (kind === "hours")
    return `«${name}» no entra: su franja de horas es más corta que una sesión (con la grilla de los bloques). Ampliá la franja en Ajustes › Rutinas o elegí «No hacer ${name}».`;
  if (kind === "habit")
    return `«${name}» no entra esta semana aunque no hubiera nada más: son más veces de las que caben en los días que quedan. Bajá las veces en Silos: tocá «${name}» y después Editar. O elegí «No hacer ${name}».`;
  if (kind === "study")
    return `«${name}» no entra esta semana aunque no hubiera nada más: son más horas de las que caben en los días que quedan. Bajá sus horas en Ajustes › Materias o elegí «No hacer ${name}».`;
  return `«${name}» no entra antes de su fecha aunque no hubiera nada más. Cambiá la fecha o el mínimo, o elegí «No hacer ${name}».`;
}

/**
 * What a routine's week holds, said the same on every screen (SPEC §18 punto 13): the
 * Bandeja, the block, Ajustes. `next`: the week after the one under way.
 */
export function routineWeekText(week: {
  done: number;
  wanted: number;
  placed: number;
  next: boolean;
}): string {
  const when = week.next ? "La semana próxima" : "Esta semana";
  return week.done >= week.wanted
    ? `${when}: ya está completa`
    : `${when} entra ${week.placed} de ${week.wanted}`;
}

/** What a silo says when the week fits only part of what it holds (SPEC §18 punto 19). */
export const siloWeekText = (placed: number, of: number) =>
  `Esta semana entran ${hours(placed)} de ${hours(of)}`;

/** The title of the Bandeja's options: the minimums fit, or not even those (SPEC §18 punto 19). */
export const optionsTitle = (minimumsMet: boolean) =>
  minimumsMet ? "Llegás a los mínimos, no a todo" : "No llegás a todo";

/** Today has nothing left in the plan. */
export const FREE_TODAY = "Hoy no queda nada por hacer: día libre.";

/** After a replan that fits skipped or moved blocks again (Roy celebrates). */
export const REPLANNED_TOAST = "Listo, reacomodé el plan. Bien ahí.";

/** Sign-in came back with an expired link (or any one-time code that no longer works). */
export const LOGIN_LINK_EXPIRED =
  "Ese enlace ya venció (duran poco y este se desarmó). Entrá de nuevo con Google y listo.";

/** The user closed or refused Google's permission screen: nothing is wrong. */
export const LOGIN_DENIED =
  "No diste el permiso de Google, y no pasa nada. Cuando quieras, tocá «Entrar con Google» de nuevo.";

/** Sign-in failed for a reason we cannot tell more about. */
export const LOGIN_FAILED =
  "No pudimos entrar esta vez. Tocá «Entrar con Google» para intentar de nuevo.";

/** What the sign-in problem in the address (`error` / `error_code`) says; null when there is none. */
export function loginProblem(params: URLSearchParams): string | null {
  const code = params.get("error_code") ?? "";
  const error = params.get("error") ?? "";
  if (!code && !error) return null;
  if (code === "otp_expired" || code === "flow_state_expired") return LOGIN_LINK_EXPIRED;
  if (error === "access_denied") return LOGIN_DENIED;
  return LOGIN_FAILED;
}

/**
 * Loss framing without pressure (SPEC §18.1): what skipping a block costs, in the minutes it
 * has and no more. Only said when the task has a date; no «last chance», nothing invented.
 */
export const skipLoss = (minutes: number, deadline: string) =>
  `Si lo salteás, el plan tiene que encontrar ${minutes >= 60 ? `${Math.round((minutes / 60) * 10) / 10} h`.replace(".", ",") : `${minutes} min`} en otro momento antes de la entrega del ${deadline}.`;
