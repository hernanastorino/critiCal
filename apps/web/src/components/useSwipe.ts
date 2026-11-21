import { type RefObject, useEffect, useRef } from "react";

/** The first touch of a list, if there is one. */
const firstOf = (list: TouchList): Touch | null => Array.from(list).at(0) ?? null;

/** How far, in px, a finger must travel sideways to count as a swipe. */
export const SWIPE_PX = 60;
/** A swipe is quick: a slower slide is a drag or a read, not a page turn. */
export const SWIPE_MS = 600;

/**
 * Sideways swipes on `ref` (touch only): left calls `onNext`, right `onPrev` (SPEC §18.12:
 * swipe to change week, with the arrows still there). A swipe has to be clearly sideways
 * (twice as wide as tall), so scrolling the day up and down never turns the page.
 */
export function useSwipe(
  ref: RefObject<HTMLElement | null>,
  { enabled, onNext, onPrev }: { enabled: boolean; onNext: () => void; onPrev: () => void },
) {
  const latest = useRef({ enabled, onNext, onPrev });
  latest.current = { enabled, onNext, onPrev };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let start: { x: number; y: number; at: number } | null = null;
    const down = (e: TouchEvent) => {
      // Two fingers are a pinch, not a swipe.
      const t = e.touches.length === 1 ? firstOf(e.touches) : null;
      start = t ? { x: t.clientX, y: t.clientY, at: e.timeStamp } : null;
    };
    const up = (e: TouchEvent) => {
      const t = firstOf(e.changedTouches);
      const from = start;
      start = null;
      if (from === null || t === null || !latest.current.enabled) return;
      const dx = t.clientX - from.x;
      const dy = t.clientY - from.y;
      if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < 2 * Math.abs(dy)) return;
      if (e.timeStamp - from.at > SWIPE_MS) return;
      if (dx < 0) latest.current.onNext();
      else latest.current.onPrev();
    };
    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchend", up, { passive: true });
    return () => {
      el.removeEventListener("touchstart", down);
      el.removeEventListener("touchend", up);
    };
  }, [ref]);
}
