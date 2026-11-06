import { type RefObject, useEffect, useRef } from "react";

/** Taps on the backdrop this soon after opening are the rest of a double tap, not a close. */
export const OPEN_GRACE_MS = 400;

/**
 * Makes a sheet a real modal: everything else in its parent is inert while it is open,
 * focus moves into it (to `focusFirst`, or the sheet's heading), Escape anywhere calls
 * `onEscape`, and focus goes back to whatever opened it on closing.
 * Returns a guard for the backdrop: true while a tap there should be ignored.
 */
export function useModal(
  sheet: RefObject<HTMLElement | null>,
  onEscape: () => void,
  focusFirst = true,
  /** Where focus goes on closing when what opened it is gone (e.g. a closed Ajustes row). */
  fallback?: () => HTMLElement | null,
): () => boolean {
  const back = useRef(fallback);
  back.current = fallback;
  const onEsc = useRef(onEscape);
  onEsc.current = onEscape;
  const openedAt = useRef(Date.now());

  useEffect(() => {
    const el = sheet.current;
    const behind = el?.parentElement
      ? [...el.parentElement.children].filter(
          (c): c is HTMLElement =>
            c instanceof HTMLElement && c !== el && !c.classList.contains("scrim"),
        )
      : [];
    const was = behind.map((c) => c.inert);
    for (const c of behind) c.inert = true;
    const opener = document.activeElement as HTMLElement | null;
    if (focusFirst) el?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    // On the document, so Escape works even after a tap left focus on the page.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onEsc.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      behind.forEach((c, i) => {
        c.inert = was[i] ?? false;
      });
      const to = opener?.isConnected && opener !== document.body ? opener : back.current?.();
      to?.focus({ preventScroll: true });
    };
  }, [sheet, focusFirst]);

  return () => Date.now() - openedAt.current < OPEN_GRACE_MS;
}
