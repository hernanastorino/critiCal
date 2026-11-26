import { type RefObject, useEffect, useRef } from "react";
import { useToast } from "./Toast.js";

/** Taps on the backdrop this soon after opening are the rest of a double tap, not a close. */
export const OPEN_GRACE_MS = 400;

interface Open {
  sheet: HTMLElement;
  escape: () => void;
}

/** Open sheets, the top one last. Only it can be reached; Escape is its alone. */
const stack: Open[] = [];
/** The inert value each element had before any sheet covered it. */
const original = new Map<HTMLElement, boolean>();

/**
 * Everything but the top sheet is inert, and the rest is put back. The sheet may sit
 * inside another one (a silo's detail inside Ajustes), so this walks up from it to the
 * body covering every sibling on the way; its own backdrop stays tappable.
 */
function cover() {
  const top = stack[stack.length - 1]?.sheet;
  const want = new Set<HTMLElement>();
  for (let n: Element | null = top ?? null; n && n !== document.body; n = n.parentElement) {
    for (const c of n.parentElement ? [...n.parentElement.children] : []) {
      if (!(c instanceof HTMLElement) || c === n) continue;
      if (c.classList.contains("scrim") && c.nextElementSibling === top) continue;
      // The app's notices stay readable and tappable over a sheet (its «Deshacer»).
      if (c.classList.contains("snacks") || c.classList.contains("toasts")) continue;
      want.add(c);
    }
  }
  for (const c of want) {
    if (!original.has(c)) original.set(c, c.inert);
    c.inert = true;
  }
  for (const [c, inert] of original) {
    if (want.has(c)) continue;
    c.inert = inert;
    original.delete(c);
  }
}

/**
 * The control last tapped. Safari does not focus a tapped button, so this is what
 * opened a sheet when nothing has focus, and where focus goes back on closing.
 */
let lastTapped: { el: HTMLElement; at: number } | null = null;
/** A tap counts as what opened a sheet only this soon before it (a notification may open one later). */
const TAP_OPENS_MS = 1000;
if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerdown",
    (e) => {
      notePress(e.clientX, e.clientY);
      const t =
        e.target instanceof Element ? e.target.closest<HTMLElement>("button, a, [tabindex]") : null;
      // A backdrop never takes focus (the second tap of a double tap lands there).
      if (t?.classList.contains("scrim")) {
        e.preventDefault();
        return;
      }
      if (t) lastTapped = { el: t, at: Date.now() };
    },
    true,
  );
}

/**
 * Taps this soon after a sheet closes are the rest of a double tap on the button that
 * closed it («Guardar», «Eliminar»): they would land on whatever is now under the finger
 * (the tab bar, the next row) and do something nobody asked for.
 */
export const CLOSE_GRACE_MS = 400;
/** A double tap lands where the first one did, give or take a finger. */
export const SAME_SPOT_PX = 40;
/** Where and when the last press was, and where the tap that closed a sheet was. */
let lastDown = { x: 0, y: 0, at: Number.NEGATIVE_INFINITY };
let closed = { x: 0, y: 0, at: Number.NEGATIVE_INFINITY };

/** Notes that a sheet closed now, from the press just before it (the tap on its button). */
export function noteClosed(now = Date.now()) {
  if (now - lastDown.at < CLOSE_GRACE_MS) closed = { x: lastDown.x, y: lastDown.y, at: now };
}

/**
 * Whether a click is the leftover of a double tap: a real tap (`isTrusted`, so what code
 * or tests dispatch is never held back), right after a sheet closed, on the same spot as
 * the tap that closed it, and not inside a sheet still open. A tap elsewhere goes through.
 */
export function isGhostTap(
  e: { isTrusted: boolean; target: EventTarget | null; clientX: number; clientY: number },
  now = Date.now(),
): boolean {
  if (!e.isTrusted || now - closed.at >= CLOSE_GRACE_MS) return false;
  if (Math.hypot(e.clientX - closed.x, e.clientY - closed.y) > SAME_SPOT_PX) return false;
  return !(e.target instanceof Element && e.target.closest(".sheet"));
}

/** For tests: a press at this spot and time, as the browser would note it. */
export function notePress(x: number, y: number, at = Date.now()) {
  lastDown = { x, y, at };
}

if (typeof document !== "undefined") {
  document.addEventListener(
    "click",
    (e) => {
      if (!isGhostTap(e)) return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
}

/** Whether the click fell on the button's box. */
function pressesUndo(e: MouseEvent, btn: HTMLElement): boolean {
  const r = btn.getBoundingClientRect();
  const inside =
    e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  return r.width > 0 && inside;
}

/**
 * The header's ↶ sits under an open sheet or popover (inert, behind its backdrop): a tap
 * on it lands on the backdrop. It undoes the last change as well as closing the sheet.
 */
function undoUnderBackdrop(e: MouseEvent) {
  const t = e.target;
  if (e.defaultPrevented || !(t instanceof Element) || !t.classList.contains("scrim")) return;
  const btn = document.querySelector<HTMLButtonElement>("button[data-header-undo]");
  if (btn && !btn.disabled && pressesUndo(e, btn)) btn.click();
}

if (typeof document !== "undefined") document.addEventListener("click", undoUnderBackdrop, true);

const FOCUSABLE =
  'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

/** What Tab can reach inside `top`, then the buttons of the open notices (their «Deshacer»). */
function tabStops(top: HTMLElement): HTMLElement[] {
  const reachable = (el: HTMLElement) =>
    !el.matches(":disabled") &&
    !el.closest("[inert], [hidden]") &&
    (typeof el.checkVisibility !== "function" || el.checkVisibility());
  return [
    ...top.querySelectorAll<HTMLElement>(FOCUSABLE),
    ...document.querySelectorAll<HTMLElement>(".snack button"),
  ].filter(reachable);
}

/**
 * Tab and Shift+Tab go round inside the top sheet (and the notices over it) instead of
 * leaving the page, where the focus would end up on nothing.
 */
function keepTabInside(e: KeyboardEvent, top: HTMLElement) {
  const stops = tabStops(top);
  const [first, last] = [stops.at(0), stops.at(-1)];
  if (!first || !last) return;
  const active = document.activeElement;
  const inside = active instanceof HTMLElement && stops.includes(active);
  // A heading that took the focus is not a stop: Shift+Tab from it goes to the end.
  const lost = !top.contains(active) && !inside;
  const edge = lost || (e.shiftKey ? !inside || active === first : active === last);
  if (!edge) return;
  e.preventDefault();
  (e.shiftKey ? last : first).focus({ preventScroll: true });
}

// One listener for every sheet, so Escape works even after a tap left focus on the page.
function onKey(e: KeyboardEvent) {
  if (e.key === "Tab" && !e.defaultPrevented) {
    const open = stack[stack.length - 1];
    if (open) keepTabInside(e, open.sheet);
    return;
  }
  if (e.key !== "Escape" || e.defaultPrevented) return;
  // A native picker that is open closes itself first (its Escape never reaches the page): with
  // the focus on a time or date field and no picker, Escape is the sheet's like anywhere else.
  const top = stack[stack.length - 1];
  if (!top) return;
  e.preventDefault();
  top.escape();
}

/** Height of the grabber bar at the top of a sheet (styles.css, `.sheet::before`). */
const GRAB_PX = 34;
/** Dragged down this far, letting go closes the sheet; less, it springs back. */
const PULL_CLOSE_PX = 70;

/**
 * The grabber at the top of a sheet: dragging it down closes the sheet (the same as ✕
 * and Escape, which stay as its buttons). Returns how to remove the listeners.
 */
function pullToClose(el: HTMLElement, close: () => void): () => void {
  let from: number | null = null;
  let dy = 0;
  const down = (e: PointerEvent) => {
    // The bar is the sheet's own ::before: a press on it has the sheet as its target.
    if (e.target !== el || e.clientY - el.getBoundingClientRect().top > GRAB_PX) return;
    from = e.clientY;
    dy = 0;
    el.classList.remove("settling");
    el.classList.add("pulling");
    el.setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (from === null) return;
    dy = Math.max(0, e.clientY - from);
    el.style.transform = `translateY(${dy}px)`;
  };
  const up = () => {
    if (from === null) return;
    from = null;
    el.classList.remove("pulling");
    if (dy >= PULL_CLOSE_PX) {
      close();
      // A sheet that stays (Ajustes going back to its list) is put back where it was.
      if (!el.isConnected) return;
    }
    el.classList.add("settling");
    el.style.transform = "";
  };
  // While pulling, the page must not scroll under the finger (it would cancel the drag).
  const touch = (e: TouchEvent) => {
    if (from !== null && e.cancelable) e.preventDefault();
  };
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("touchmove", touch, { passive: false });
  return () => {
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    el.removeEventListener("touchmove", touch);
    el.classList.remove("pulling", "settling");
    el.style.transform = "";
  };
}

/**
 * Makes a sheet a real modal: everything else is inert while it is the top one (even
 * what mounts later, like a tab a notification switches to), focus moves into it (to its
 * heading when `focusFirst`), Escape calls `onEscape`, and focus goes back to whatever
 * opened it on closing, or to `fallback` when that is gone (Safari does not focus a tapped
 * button). Returns a guard for the backdrop: true while a tap there should be ignored.
 */
export function useModal(
  sheet: RefObject<HTMLElement | null>,
  onEscape: () => void,
  focusFirst = true,
  fallback?: () => HTMLElement | null,
  /** The fallback wins over what had focus (a block's detail goes back to that block). */
  preferFallback = false,
): () => boolean {
  const onEsc = useRef(onEscape);
  onEsc.current = onEscape;
  const back = useRef(fallback);
  back.current = fallback;
  const openedAt = useRef(Date.now());
  // A notice from before the sheet opened would sit over its lower rows; the ones that
  // come with it open stay (the «Deshacer» of something done inside).
  const { clear } = useToast();
  const clearToast = useRef(clear);
  clearToast.current = clear;

  useEffect(() => {
    const el = sheet.current;
    if (!el) return;
    const me: Open = { sheet: el, escape: () => onEsc.current() };
    if (stack.length === 0) document.addEventListener("keydown", onKey);
    stack.push(me);
    clearToast.current();
    cover();
    // Whatever mounts later around it (a tab a notification switches to) is covered too.
    const observer = new MutationObserver(cover);
    observer.observe(document.body, { childList: true, subtree: true });
    const focused = document.activeElement as HTMLElement | null;
    const tapped = lastTapped && Date.now() - lastTapped.at < TAP_OPENS_MS ? lastTapped.el : null;
    const opener = focused && focused !== document.body ? focused : tapped;
    // A sheet without a name of its own is named by its heading for VoiceOver, before
    // focus moves in, so it is announced with it.
    const heading = el.querySelector<HTMLElement>("h2");
    if (heading && !el.hasAttribute("aria-label") && !el.hasAttribute("aria-labelledby")) {
      heading.id ||= `sheet-title-${Math.random().toString(36).slice(2)}`;
      el.setAttribute("aria-labelledby", heading.id);
    }
    if (focusFirst) {
      // Where it asks to start ([data-autofocus]), else its heading, else its first control.
      const first =
        el.querySelector<HTMLElement>("[data-autofocus]") ??
        el.querySelector<HTMLElement>("h2") ??
        el.querySelector<HTMLElement>("button");
      if (first && first.tagName === "H2" && !first.hasAttribute("tabindex")) first.tabIndex = -1;
      first?.focus({ preventScroll: true });
    }
    const release = el.classList.contains("sheet") ? pullToClose(el, () => onEsc.current()) : null;
    return () => {
      release?.();
      observer.disconnect();
      const wasTop = stack[stack.length - 1] === me;
      stack.splice(stack.indexOf(me), 1);
      noteClosed();
      cover();
      if (stack.length === 0) document.removeEventListener("keydown", onKey);
      // A sheet closing under another one leaves the focus where it is.
      if (!wasTop) return;
      const usable = (n: HTMLElement | null | undefined) =>
        !!n && n.isConnected && n !== document.body && !n.closest("[inert]");
      // With another sheet still open, focus goes back into it.
      const lower = stack[stack.length - 1]?.sheet;
      const below =
        lower?.querySelector<HTMLElement>("h2") ?? lower?.querySelector<HTMLElement>("button");
      const preferred = preferFallback ? back.current?.() : null;
      const to = usable(preferred)
        ? preferred
        : usable(opener)
          ? opener
          : (below ?? back.current?.());
      to?.focus({ preventScroll: true });
    };
  }, [sheet, focusFirst, preferFallback]);

  return () => Date.now() - openedAt.current < OPEN_GRACE_MS;
}
