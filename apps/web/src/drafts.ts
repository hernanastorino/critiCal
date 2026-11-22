import { useState } from "react";

/**
 * What was typed in a form (Ajustes, the editor of a silo or entrega) and not saved yet.
 * Closing the sheet unmounts the form, so the text waits here; it is mirrored to
 * `sessionStorage` so a reload of the page brings the form back as it was (SPEC §14).
 * It dies with the tab, and with the account (`clearDrafts`).
 */
/** What was typed, with what it was compared to when the form was last saved. */
type Entry = { value: unknown; base: unknown };
const STORE = "critical.drafts";
/** The editor of a silo or entrega keeps its draft under this prefix, apart from Ajustes'. */
export const SHEET_PREFIX = "sheet:";

function load(): Map<string, Entry> {
  try {
    const raw = globalThis.sessionStorage?.getItem(STORE);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return new Map(Object.entries(parsed as Record<string, Entry>));
    }
  } catch {
    // Storage blocked or corrupt: no drafts, nothing breaks.
  }
  return new Map();
}
const drafts = load();

function persist(): void {
  try {
    if (drafts.size === 0) globalThis.sessionStorage?.removeItem(STORE);
    else globalThis.sessionStorage?.setItem(STORE, JSON.stringify(Object.fromEntries(drafts)));
  } catch {
    // Full or blocked: the draft still lives in memory.
  }
}

/** Forgets every draft (a different account, a reset demo). */
export function clearDrafts(): void {
  drafts.clear();
  persist();
  rememberSettingsPage(null);
}

/** Whether something typed in Ajustes waits unsaved. */
export function hasSettingsDrafts(): boolean {
  for (const k of drafts.keys()) if (!k.startsWith(SHEET_PREFIX)) return true;
  return false;
}

const PAGE = "critical.settingsPage";

/** Which screen of Ajustes is open (`null`: its list), for a reload to bring it back. */
export function rememberSettingsPage(page: string | null): void {
  try {
    if (page) globalThis.sessionStorage?.setItem(PAGE, page);
    else globalThis.sessionStorage?.removeItem(PAGE);
  } catch {
    // Blocked storage: the reload lands on the list.
  }
}

/** Ajustes as a reload should find it: open (on its screen) when something waits unsaved. */
export function settingsToRestore(): string | true | false {
  const editor = readSheetDraft<{ origin: string }>("editor");
  if (!hasSettingsDrafts() && editor?.origin !== "preferences") return false;
  try {
    return globalThis.sessionStorage?.getItem(PAGE) || true;
  } catch {
    return true;
  }
}

/** Forgets what was typed in Ajustes only (closing it with «Descartar»). */
export function clearSettingsDrafts(): void {
  for (const k of [...drafts.keys()]) if (!k.startsWith(SHEET_PREFIX)) drafts.delete(k);
  persist();
}

/** A stored draft of a sheet's form, if any. */
export function readSheetDraft<T>(key: string): T | null {
  return drafts.has(SHEET_PREFIX + key) ? (drafts.get(SHEET_PREFIX + key)?.value as T) : null;
}

/** Keeps (`value`) or, with `null`, forgets a sheet's draft. */
export function writeSheetDraft(key: string, value: unknown): void {
  if (value === null) drafts.delete(SHEET_PREFIX + key);
  else drafts.set(SHEET_PREFIX + key, { value, base: null });
  persist();
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
    // Back to what it was compared to: nothing is pending, so nothing is kept.
    if (JSON.stringify(next) === JSON.stringify(base)) drafts.delete(key);
    else drafts.set(key, { value: next, base });
    persist();
    setValue(next);
  };
  /** After saving: what is shown is now what is stored. */
  const saved = (next: T) => {
    drafts.delete(key);
    persist();
    setBase(next);
    setValue(next);
  };
  const dirty = JSON.stringify(value) !== JSON.stringify(base);
  return [value, set, saved, dirty] as const;
}
