import type { AppData } from "./model.js";

/**
 * The data from before the last import, kept in memory so the header's «Deshacer» can put
 * it back (the toast has the same button). It is the last undoable action only while
 * nothing versioned came after it: a later change goes first, and once taken back the
 * import is the last one again.
 */
let pending: { before: AppData; last: unknown } | null = null;

/** Remembers `before`, replaced by `after` (what the import stored). */
export function rememberImport(before: AppData, after: AppData): void {
  pending = { before, last: after.planHistory?.at(-1) };
}

export function forgetImport(): void {
  pending = null;
}

/** What the header would undo as the import: the data before it, if it is still the last change. */
export function importToUndo(data: AppData): AppData | null {
  if (!pending || pending.last !== data.planHistory?.at(-1)) return null;
  return pending.before.owner === data.owner ? pending.before : null;
}
