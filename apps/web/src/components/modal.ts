import { type RefObject, useEffect, useRef } from "react";

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
      if (c.classList.contains("snacks")) continue;
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

// One listener for every sheet, so Escape works even after a tap left focus on the page.
function onKey(e: KeyboardEvent) {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  // An open native picker (time, date) closes itself first.
  const t = e.target;
  if (t instanceof HTMLInputElement && /^(time|date|datetime-local|month|week)$/.test(t.type)) {
    return;
  }
  const top = stack[stack.length - 1];
  if (!top) return;
  e.preventDefault();
  top.escape();
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

  useEffect(() => {
    const el = sheet.current;
    if (!el) return;
    const me: Open = { sheet: el, escape: () => onEsc.current() };
    if (stack.length === 0) document.addEventListener("keydown", onKey);
    stack.push(me);
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
    return () => {
      observer.disconnect();
      const wasTop = stack[stack.length - 1] === me;
      stack.splice(stack.indexOf(me), 1);
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
