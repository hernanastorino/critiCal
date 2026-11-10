// Downloads the open data, turns it into a compact feed and stores it (weekly, from the
// database's cron). A failed or suspiciously small download keeps the feed already stored.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Source } from "./feed.js";
import { parseGtfs } from "./gtfs.js";
import { parseStm } from "./stm.js";
import { saveFeed, storedPatterns } from "./store.js";
import { unzip } from "./zip.js";

const IM = "https://datos-abiertos.montevideo.gub.uy";
const GIS = "https://intgis.montevideo.gub.uy";
const CATALOG = "https://catalogodatos.gub.uy";
const DNT_PACKAGE =
  "ministerio-de-transporte-y-obras-publicas-horarios-de-omnibus-en-lineas-interdepartamentales";

/** Biggest download accepted (the largest real one is ~11 MB). */
const MAX_BYTES = 60 * 1024 * 1024;
const AGENT = "critiCal/1.0 (+https://critical-cal.vercel.app)";

/** A new feed smaller than this share of the stored one is refused as a broken download. */
const MIN_SHARE = 0.6;
/** Below these there is nothing to route on; the invented dev feed has just a few. */
const MIN_PATTERNS: Record<Source, number> = { stm: 500, dnt: 3 };

async function get(url: string, fetcher: typeof fetch): Promise<Response> {
  const res = await fetcher(url, {
    headers: { "User-Agent": AGENT },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`download_${res.status}`);
  return res;
}

async function download(url: string, fetcher: typeof fetch): Promise<Buffer> {
  const res = await get(url, fetcher);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) throw new Error("download_too_big");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("download_too_big");
  return buf;
}

/** The one file with this extension inside a zip. */
function entry(zip: Map<string, Buffer>, ext: string): Buffer {
  for (const [name, data] of zip) if (name.toLowerCase().endsWith(ext)) return data;
  throw new Error(`zip_missing_${ext}`);
}

/** The Intendencia's GIS portal builds each table's zip on request, then serves it from /sit/tmp. */
async function gisTable(table: string, fetcher: typeof fetch): Promise<Map<string, Buffer>> {
  const page = await (
    await get(`${GIS}/sit/php/common/datos/generar_zip2.php?nom_tab=${table}&tipo=gis`, fetcher)
  ).text();
  const path = /action\s*=\s*'(\/sit\/tmp\/[a-z_]+\.zip)'/.exec(page)?.[1];
  if (!path) throw new Error("gis_link_missing");
  return unzip(await download(`${GIS}${path}`, fetcher));
}

export async function buildStm(fetcher: typeof fetch = fetch) {
  const [variante, circular, paradas, noMaximal] = await Promise.all([
    download(`${IM}/uptu_pasada_variante.zip`, fetcher),
    download(`${IM}/uptu_pasada_circular.zip`, fetcher),
    gisTable("v_uptu_paradas", fetcher),
    gisTable("uptu_variante_no_maximal", fetcher),
  ]);
  return parseStm({
    variante: entry(unzip(variante), ".csv").toString("utf8"),
    circular: entry(unzip(circular), ".csv").toString("utf8"),
    paradas: entry(paradas, ".dbf"),
    noMaximal: entry(noMaximal, ".dbf"),
  });
}

export async function buildDnt(fetcher: typeof fetch = fetch) {
  // The zip's name carries its date, so the catalog says where the current one is.
  const pkg = (await (
    await get(`${CATALOG}/api/3/action/package_show?id=${DNT_PACKAGE}`, fetcher)
  ).json()) as {
    result?: {
      resources?: { name?: string; format?: string; url?: string; last_modified?: string }[];
    };
  };
  const found = (pkg.result?.resources ?? [])
    .filter((r) => /gtfs/i.test(r.name ?? "") && /zip/i.test(r.format ?? "") && r.url)
    .sort((a, b) => (b.last_modified ?? "").localeCompare(a.last_modified ?? ""))[0];
  if (!found?.url || new URL(found.url).origin !== CATALOG) throw new Error("gtfs_link_missing");
  const zip = unzip(await download(found.url, fetcher));
  const text = (name: string) => {
    const file = zip.get(name);
    if (!file) throw new Error(`gtfs_missing_${name}`);
    return file.toString("utf8");
  };
  return parseGtfs({
    agency: text("agency.txt"),
    routes: text("routes.txt"),
    calendar: text("calendar.txt"),
    trips: text("trips.txt"),
    stops: text("stops.txt"),
    stopTimes: text("stop_times.txt"),
  });
}

export interface ImportResult {
  source: Source;
  ok: boolean;
  error?: string;
  version?: string;
  patterns?: number;
  stops?: number;
  trips?: number;
  ms: number;
}

/** Imports one source. Never throws: the result says what happened. */
export async function importSource(
  admin: SupabaseClient,
  source: Source,
  fetcher: typeof fetch = fetch,
): Promise<ImportResult> {
  const started = Date.now();
  try {
    const { feed, stats } = source === "stm" ? await buildStm(fetcher) : await buildDnt(fetcher);
    const patterns = feed.patterns.length;
    if (patterns < MIN_PATTERNS[source] || feed.stops.length < 10)
      throw new Error("feed_too_small");
    const before = await storedPatterns(admin, source);
    if (before && patterns < before * MIN_SHARE) throw new Error("feed_shrunk");
    await saveFeed(admin, feed, { ...stats, patterns, stops: feed.stops.length });
    return {
      source,
      ok: true,
      version: feed.version,
      patterns,
      stops: feed.stops.length,
      trips: stats.trips,
      ms: Date.now() - started,
    };
  } catch (e) {
    return {
      source,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      ms: Date.now() - started,
    };
  }
}
