import type { ReactNode } from "react";
import { Roy, type RoyAnim } from "./Roy.js";

/** What is being waited for: each has its own words, and later its own animation. */
export type LoadingKind = "sync" | "ai" | "travel" | "generic";

const WORDS: Record<LoadingKind, string> = {
  sync: "Sincronizando tu calendario…",
  ai: "Leyendo el programa…",
  travel: "Calculando traslados…",
  generic: "Cargando…",
};

/** The shape Roy takes for each wait (SPEC §18.1). */
export const LOADING_ANIM: Record<LoadingKind, RoyAnim> = {
  generic: "cascada",
  sync: "vayvuelve",
  ai: "acordeon",
  travel: "oruga",
};

/** The words a wait shows: `label` when given, else the kind's; with progress, «3 de 8». */
export function loadingText(
  kind: LoadingKind,
  label?: string,
  progress?: { done: number; total: number },
): string {
  const base = (label ?? WORDS[kind]).replace(/…$/, "");
  return progress && progress.total > 0
    ? `${base} ${Math.min(progress.done + 1, progress.total)} de ${progress.total}…`
    : `${base}…`;
}

/**
 * The one way to say "wait a moment" (SPEC §14): says what is happening, and how far
 * along when that is known. Every caller names a `kind`, so the animation drawn here
 * can change in one place. Roy is drawn by default, in the shape of the kind; `mascot` replaces him.
 */
export function Loading({
  kind = "generic",
  label,
  progress,
  mascot,
  inline,
}: {
  kind?: LoadingKind;
  /** Replaces the kind's default words (without the ellipsis). */
  label?: string;
  /** Items finished out of the total, when it is known. */
  progress?: { done: number; total: number };
  mascot?: ReactNode;
  /** Small, next to a button or a line of text, instead of a block. */
  inline?: boolean;
}) {
  const text = loadingText(kind, label, progress);
  return (
    <div className={`loading${inline ? " inline" : ""}`} data-kind={kind} role="status">
      {mascot ?? <Roy anim={LOADING_ANIM[kind]} size={inline ? 24 : 72} />}
      <span className="loading-text">{text}</span>
      {progress && progress.total > 0 && (
        <progress
          className="loading-bar"
          max={progress.total}
          value={Math.min(progress.done, progress.total)}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
