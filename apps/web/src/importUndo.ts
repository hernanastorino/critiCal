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
  extras = null;
}

/** Puts back in the database what the import wrote beside the store (events, routes). */
let extras: Promise<() => Promise<void>> | null = null;

/** The way back of what the import wrote to the database; it waits for the writes to finish. */
export function rememberImportExtras(undo: Promise<() => Promise<void>>): void {
  extras = undo;
}

/** Takes back what the import wrote to the database, once (the ↶ and the notice both call it). */
export async function undoImportExtras(): Promise<void> {
  const pending = extras;
  extras = null;
  if (pending) await (await pending)();
}

export function forgetImport(): void {
  pending = null;
}

/** What the header would undo as the import: the data before it, if it is still the last change. */
export function importToUndo(data: AppData): AppData | null {
  if (!pending || pending.last !== data.planHistory?.at(-1)) return null;
  return pending.before.owner === data.owner ? pending.before : null;
}
