// Helpers of the 11th round of tests: the demo as a backup file, edited at a path.
import { exportJson, parseBackup } from "./backup.js";
import { demoData, TIMEZONE } from "./demo.js";
import { zonedInstant } from "./engine.js";
import type { AppData } from "./model.js";

export const NOW = zonedInstant(TIMEZONE, "2026-11-18", 12 * 60);
export const GENERIC = "Al respaldo le faltan datos.";

export const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x));
/** What a backup keeps of `x`: not the history of the ↶, and the (empty) list of saved bus routes. */
export const kept = <T extends object>(x: T) => ({
  ...plain(x),
  planHistory: undefined,
  busRoutes: [],
});
export const errorOf = (r: ReturnType<typeof parseBackup>) => ("error" in r ? r.error : "");
export const roundTrip = (d: AppData, opts?: { account?: string }) =>
  parseBackup(exportJson(d, NOW), opts);

/** One change to the data: a dotted path («tasks.0.priority», «tasks.last.title») and the new value (`undefined` removes it). */
export type Edit = [path: string, value: unknown];

function setAt(root: object, path: string, value: unknown): void {
  const keys = path.split(".");
  const last = keys.pop() ?? "";
  let at: object = root;
  for (const key of keys) {
    const here = Array.isArray(at) && key === "last" ? String(at.length - 1) : key;
    at = Reflect.get(at, here) as object;
  }
  const field = Array.isArray(at) && last === "last" ? String(at.length - 1) : last;
  if (value === undefined) Reflect.deleteProperty(at, field);
  else Reflect.set(at, field, value);
}

/** The demo with `edits` applied, as a backup file, parsed. */
export function edited(edits: Edit[], opts?: { account?: string }) {
  const d = plain(demoData(NOW));
  for (const [path, value] of edits) setAt(d, path, value);
  return parseBackup(
    JSON.stringify({ app: "critiCal", version: 2, exportedAt: NOW, data: d }),
    opts,
  );
}
