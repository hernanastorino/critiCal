import { useRef } from "react";

/** A second tap on the same button this soon after the first is the same tap again. */
const SAME_TAP_MS = 700;

/**
 * Runs a save at most once per burst of taps: «Guardar parcial» fired twice in the same
 * instant (a double tap, two clicks before the screen redraws) answers once, not twice. The
 * second call finds the state it closed over still old, so only a memory outside the render
 * can tell. `key` names what is being saved: other saves are not held back.
 */
export function useTapOnce(): (key: string, run: () => void) => void {
  const last = useRef<{ key: string; at: number } | null>(null);
  return (key, run) => {
    const at = Date.now();
    if (last.current && last.current.key === key && at - last.current.at < SAME_TAP_MS) return;
    last.current = { key, at };
    run();
  };
}
