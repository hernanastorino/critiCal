import { useEffect, useRef, useState } from "react";

/** How long a number takes to count to its new value. */
export const COUNT_MS = 450;

/** The value shown `t` (0–1) of the way from `from` to `to`, easing out, in whole units. */
export function countStep(from: number, to: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  const eased = 1 - (1 - k) ** 3;
  return Math.round(from + (to - from) * eased);
}

/** Jump straight to the value: tests, no animation frames, or «reduce motion». */
function still(): boolean {
  if (import.meta.env.MODE === "test") return true;
  if (typeof requestAnimationFrame !== "function") return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * `value`, counting to it when it changes (SPEC §14: the hours of the silos and the totals
 * count to the new value instead of jumping). The first value is shown as it is.
 */
export function useCountUp(value: number): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value || still()) {
      from.current = value;
      setShown(value);
      return;
    }
    const began = performance.now();
    let frame = 0;
    const tick = (at: number) => {
      const t = (at - began) / COUNT_MS;
      const next = countStep(start, value, t);
      from.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return shown;
}

/** A number of minutes as `format` writes it, counting when it changes. */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  return <>{format(useCountUp(value))}</>;
}
