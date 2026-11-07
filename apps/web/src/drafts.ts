import { useState } from "react";

/**
 * What was typed in a form of Ajustes and not saved yet. Closing the sheet unmounts
 * the form, so the text waits here until the app is reloaded (SPEC §14: nothing typed is
 * lost, and no «¿Descartar?» dialog).
 */
/** What was typed, with what it was compared to when the form was last saved. */
const drafts = new Map<string, { value: unknown; base: unknown }>();

/** Forgets every draft (a different account, a reset demo). */
export function clearDrafts(): void {
  drafts.clear();
}

/**
 * Like `useState`, but the value outlives the form. `dirty` is whether it differs from
 * `initial`; saving sets it back to what was saved and it goes clean.
 */
export function useDraft<T>(key: string, initial: () => T) {
  const [base, setBase] = useState<T>(() =>
    drafts.has(key) ? (drafts.get(key)?.base as T) : initial(),
  );
  const [value, setValue] = useState<T>(() =>
    drafts.has(key) ? (drafts.get(key)?.value as T) : base,
  );
  const set = (next: T) => {
    drafts.set(key, { value: next, base });
    setValue(next);
  };
  /** After saving: what is shown is now what is stored. */
  const saved = (next: T) => {
    drafts.delete(key);
    setBase(next);
    setValue(next);
  };
  const dirty = JSON.stringify(value) !== JSON.stringify(base);
  return [value, set, saved, dirty] as const;
}
