// Where the compacted feeds live (table `transit_feed`, service role only) and the
// in-memory copy a warm function keeps so a request does not download them again.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FeedInfo } from "../../../src/transit.js";
import type { DayType } from "./feed.js";
import { decodeFeed, encodeFeed, type Feed, type Source } from "./feed.js";
import { buildNetwork, type Network, type Schedule, scheduleFor } from "./network.js";

interface Row {
  source: Source;
  version: string;
  built_at: string;
  valid_to: string | null;
}

export interface Loaded {
  net: Network;
  info: FeedInfo;
}

/** How long a warm instance trusts its copy before asking which versions are current. */
const FRESH_MS = 10 * 60_000;

let cache: { key: string; checkedAt: number; loaded: Loaded } | null = null;
const schedules = new Map<string, Schedule>();

/** Tests only. */
export function resetTransitCache() {
  cache = null;
  schedules.clear();
}

export function describeFeeds(rows: Row[]): FeedInfo {
  const sorted = [...rows].sort((a, b) => a.source.localeCompare(b.source));
  const ends = sorted.map((r) => r.valid_to).filter((d): d is string => !!d);
  return {
    version: sorted.map((r) => `${r.source}:${r.version}`).join("|"),
    builtAt: sorted
      .map((r) => r.built_at)
      .sort()
      .at(-1) as string,
    validTo: ends.sort()[0] ?? null,
    sources: sorted.map((r) => ({
      source: r.source,
      version: r.version,
      builtAt: r.built_at,
      validTo: r.valid_to,
    })),
  };
}

const COLUMNS = "source, version, built_at, valid_to";

/** Which versions are stored now, without their payloads. Null before the first import. */
export async function feedInfo(admin: SupabaseClient): Promise<FeedInfo | null> {
  const { data, error } = await admin.from("transit_feed").select(COLUMNS);
  if (error) throw error;
  const rows = (data ?? []) as Row[];
  return rows.length ? describeFeeds(rows) : null;
}

/** The searchable network of the stored feeds, or null before the first import. */
export async function loadNetwork(admin: SupabaseClient, now = Date.now()): Promise<Loaded | null> {
  if (cache && now - cache.checkedAt < FRESH_MS) return cache.loaded;
  const info = await feedInfo(admin);
  if (!info) return null;
  if (cache && cache.key === info.version) {
    cache.checkedAt = now;
    return cache.loaded;
  }
  const { data, error } = await admin.from("transit_feed").select("source, payload");
  if (error) throw error;
  const feeds = ((data ?? []) as { source: Source; payload: string }[]).map((r) =>
    decodeFeed(r.payload),
  );
  const loaded = { net: buildNetwork(feeds), info };
  cache = { key: info.version, checkedAt: now, loaded };
  schedules.clear();
  return loaded;
}

/** The departures of one date, kept while the feeds stay the same. */
export function scheduleOn(
  loaded: Loaded,
  date: string,
  today: DayType,
  yesterday: DayType,
  previous: string,
): Schedule {
  const key = `${loaded.info.version}|${date}|${today}${yesterday}`;
  let s = schedules.get(key);
  if (!s) {
    if (schedules.size >= 8) schedules.clear();
    s = scheduleFor(loaded.net, date, today, yesterday, previous);
    schedules.set(key, s);
  }
  return s;
}

export async function saveFeed(
  admin: SupabaseClient,
  feed: Feed,
  stats: Record<string, number>,
): Promise<void> {
  const { error } = await admin.from("transit_feed").upsert({
    source: feed.source,
    version: feed.version,
    built_at: new Date().toISOString(),
    valid_to: feed.validTo,
    stats,
    payload: encodeFeed(feed),
  });
  if (error) throw error;
}

/** Pattern count of the stored feed (to refuse an import that shrinks it), or 0. */
export async function storedPatterns(admin: SupabaseClient, source: Source): Promise<number> {
  const { data, error } = await admin
    .from("transit_feed")
    .select("stats")
    .eq("source", source)
    .maybeSingle();
  if (error) throw error;
  return Number((data?.stats as { patterns?: number } | null)?.patterns ?? 0);
}
