import { useEffect } from "react";

/**
 * Escape leaves the week's edit mode and puts the keyboard back on the pencil. A sheet or
 * bubble that is open takes the key first (it is a dialog), and a native picker closes itself.
 */
export function useEditEscape(editing: boolean, stop: () => void) {
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof HTMLInputElement && /^(time|date|datetime-local|month|week)$/.test(t.type)) {
        return;
      }
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      stop();
      document.querySelector<HTMLElement>('button[aria-label="Modo edición"]')?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editing, stop]);
}
