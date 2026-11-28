// What a backup file brings that the sync does not write by itself (SPEC §18.20): the
// calendar events (only the server writes them, from Google or iCloud). Written with the key
// the server upserts on (`source` + `external_id`), so the next sync of that calendar finds
// them and updates them in place instead of making copies.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppEvent } from "./model.js";

/** The event as its row: its id is `source:externalId`, as `eventOf` reads it. */
export function eventRow(e: AppEvent) {
  const own = (id: string) => (id.startsWith(`${e.source}:`) ? id.slice(e.source.length + 1) : id);
  return {
    source: e.source,
    external_id: own(e.id),
    calendar_id: e.calendarId ? own(e.calendarId) : null,
    title: e.title,
    start_at: new Date(e.start).toISOString(),
    end_at: new Date(e.end).toISOString(),
    location: e.location ?? null,
    busy: e.busy,
    all_day: !!e.allDay,
    tentative: !!e.tentative,
    link: e.link ?? null,
  };
}

const CHUNK = 500;
type Row = Record<string, unknown>;

/** Every event row of the account, as it is now; null when the database did not answer. */
export async function savedEvents(client: SupabaseClient): Promise<Row[] | null> {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from("calendar_events")
      .select("*")
      .order("source")
      .order("external_id")
      .range(from, from + 999);
    if (error) return null;
    rows.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < 1000) return rows;
  }
}

/**
 * Leaves the events as `before` had them: the ones a load wrote that were not there go, and
 * the ones it overwrote come back. False when the database refused.
 */
export async function restoreEvents(
  client: SupabaseClient,
  before: readonly Row[],
  written: readonly AppEvent[],
): Promise<boolean> {
  const had = new Set(before.map((r) => `${String(r.source)}|${String(r.external_id)}`));
  const added = written
    .filter((e) => e.source === "google" || e.source === "icloud")
    .map(eventRow)
    .filter((r) => !had.has(`${r.source}|${r.external_id}`));
  for (const source of ["google", "icloud"]) {
    const ids = added.filter((r) => r.source === source).map((r) => r.external_id);
    for (let i = 0; i < ids.length; i += 100) {
      const { error } = await client
        .from("calendar_events")
        .delete()
        .eq("source", source)
        .in("external_id", ids.slice(i, i + 100));
      if (error) return false;
    }
  }
  for (let i = 0; i < before.length; i += CHUNK) {
    const { error } = await client.from("calendar_events").upsert(before.slice(i, i + CHUNK));
    if (error) return false;
  }
  return true;
}

/**
 * Writes the events that came from a calendar. The demo's events are not rows (the table
 * only knows Google and iCloud). Returns false when the database refused them.
 */
export async function saveEvents(
  client: SupabaseClient,
  events: readonly AppEvent[],
): Promise<boolean> {
  const rows = events.filter((e) => e.source === "google" || e.source === "icloud").map(eventRow);
  // One row per key: two with the same one in a single request is an error.
  const unique = [...new Map(rows.map((r) => [`${r.source}|${r.external_id}`, r])).values()];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const { error } = await client.from("calendar_events").upsert(unique.slice(i, i + CHUNK));
    if (error) return false;
  }
  return true;
}
