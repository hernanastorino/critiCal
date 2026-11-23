import { type RefObject, useEffect, useRef } from "react";

/** The first touch of a list, if there is one. */
const firstOf = (list: TouchList): Touch | null => Array.from(list).at(0) ?? null;

/** How far, in px, a finger must travel sideways to count as a swipe. */
export const SWIPE_PX = 60;
/** A swipe is quick: a slower slide is a drag or a read, not a page turn. */
export const SWIPE_MS = 600;

/**
 * Whether a finger's travel is a swipe, and which way: clearly sideways (twice as wide as
 * tall), far enough and quick. `null` for a scroll, a tap or a slow slide.
 */
export function swipeOf(dx: number, dy: number, ms: number): "left" | "right" | null {
  if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < 2 * Math.abs(dy) || ms > SWIPE_MS) return null;
  return dx < 0 ? "left" : "right";
}

/** A short buzz where the browser has one (Android); iOS Safari has no API, so nothing there. */
export function buzz(): void {
  if (typeof navigator !== "undefined") navigator.vibrate?.(10);
}

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
      const way = swipeOf(dx, dy, e.timeStamp - from.at);
      if (way === "left") latest.current.onNext();
      else if (way === "right") latest.current.onPrev();
    };
    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchend", up, { passive: true });
    return () => {
      el.removeEventListener("touchstart", down);
      el.removeEventListener("touchend", up);
    };
  }, [ref]);
}

/** How far a card follows the finger, in px: a hint of where it is going, not the whole way. */
const FOLLOW_PX = 72;

const calm = (): boolean =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The card goes back to its place. */
const rest = (el: HTMLElement) => {
  el.style.transform = "";
  el.removeAttribute("data-swiping");
};

/** Where the finger is down (one at a time, so a re-render mid-swipe loses nothing). */
let cardStart: { x: number; y: number; at: number } | null = null;

/** The touch handlers of one card answer: right is «Hecho», left is «No hecho» (as its buttons). */
type SwipeAnswer = {
  onTouchStart: (e: import("react").TouchEvent<HTMLElement>) => void;
  onTouchMove: (e: import("react").TouchEvent<HTMLElement>) => void;
  onTouchEnd: (e: import("react").TouchEvent<HTMLElement>) => void;
  onTouchCancel: (e: import("react").TouchEvent<HTMLElement>) => void;
};

/**
 * Sideways swipe on a card to answer it: to the right «hecho», to the left «no hecho», the
 * same answer (and «Deshacer») as its buttons, which stay on the card. The card leans toward
 * the finger as a hint, unless the system asks to reduce motion; the swipe still works.
 * Vertical scrolling is left alone (`touch-action: pan-y` in the stylesheet).
 */
export function swipeAnswer(onAnswer: (status: "done" | "missed") => void): SwipeAnswer {
  return {
    onTouchStart: (e) => {
      const touches = e.touches;
      const t = touches.length === 1 ? firstOf(touches as unknown as TouchList) : null;
      cardStart = t ? { x: t.clientX, y: t.clientY, at: e.timeStamp } : null;
    },
    onTouchMove: (e) => {
      const t = firstOf(e.touches as unknown as TouchList);
      if (!cardStart || !t || calm()) return;
      const dx = t.clientX - cardStart.x;
      if (Math.abs(dx) < 2 * Math.abs(t.clientY - cardStart.y)) return;
      e.currentTarget.setAttribute("data-swiping", dx < 0 ? "missed" : "done");
      e.currentTarget.style.transform = `translateX(${Math.max(-FOLLOW_PX, Math.min(FOLLOW_PX, dx / 2))}px)`;
    },
    onTouchEnd: (e) => {
      const card = e.currentTarget;
      const t = firstOf(e.changedTouches as unknown as TouchList);
      const from = cardStart;
      cardStart = null;
      rest(card);
      if (!from || !t) return;
      const way = swipeOf(t.clientX - from.x, t.clientY - from.y, e.timeStamp - from.at);
      if (way) onAnswer(way === "right" ? "done" : "missed");
    },
    onTouchCancel: (e) => {
      cardStart = null;
      rest(e.currentTarget);
    },
  };
}
