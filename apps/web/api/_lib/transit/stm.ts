// Montevideo's urban system (STM), from the Intendencia's open data: theoretical stop
// passes per trip ("uptu_pasada_variante" and "..._circular"), the stops as a shapefile
// table in UTM coordinates, and the table that ties every variant to its main one (the
// only ones the stop table names a line for).
// Licence: Licencia de Datos Abiertos de Uruguay (attribution), see docs/OPERATIONS.md.
import { readDbf } from "./dbf.js";
import { type DayType, type Feed, FeedBuilder } from "./feed.js";
import { utm21sToLatLon } from "./geo.js";

export interface StmFiles {
  /** uptu_pasada_variante.csv */
  variante: string;
  /** uptu_pasada_circular.csv */
  circular: string;
  /** v_uptu_paradas.dbf */
  paradas: Buffer;
  /** uptu_variante_no_maximal.dbf */
  noMaximal: Buffer;
}

export interface StmStats {
  trips: number;
  skippedTrips: number;
  unresolvedVariants: number;
}

/** Service days run from 04:00 to 04:00 (the source says so): earlier clock times belong to the day before. */
const DAY_START = 240;
/** A pass this early before its trip's start is the next clock day, not rounding. */
const WRAP_SLACK = 120;

const clock = (hmm: number) => Math.floor(hmm / 100) * 60 + (hmm % 100);

interface Row {
  ordinal: number;
  part: number;
  stop: number;
  hora: number;
  variant: number;
}

/** Walks `text` line by line without splitting the whole file into an array. */
function* lines(text: string): Generator<string> {
  let at = text.indexOf("\n") + 1; // skips the header
  while (at > 0 && at < text.length) {
    let end = text.indexOf("\n", at);
    if (end < 0) end = text.length;
    const line = text.slice(at, end).trim();
    if (line) yield line;
    at = end + 1;
  }
}

export function parseStm(files: StmFiles): { feed: Feed; stats: StmStats } {
  const b = new FeedBuilder();
  const coords = new Map<number, { lat: number; lon: number }>();
  const names = new Map<number, string>();
  const lineOf = new Map<number, string>();
  const headOf = new Map<number, { ordinal: number; name: string }>();
  for (const r of readDbf(files.paradas)) {
    const code = Number(r.COD_UBIC_P);
    const x = Number(r.X);
    const y = Number(r.Y);
    if (!Number.isFinite(code) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    coords.set(code, utm21sToLatLon(x, y));
    names.set(code, [r.CALLE, r.ESQUINA].filter(Boolean).join(" y "));
    const variant = Number(r.COD_VARIAN);
    if (r.DESC_LINEA) lineOf.set(variant, r.DESC_LINEA);
    const ordinal = Number(r.ORDINAL);
    const last = headOf.get(variant);
    if (!last || ordinal > last.ordinal) headOf.set(variant, { ordinal, name: r.CALLE ?? "" });
  }
  // Variants that run part of a main variant's route take its line and heading.
  const mainOf = new Map<number, number>();
  for (const r of readDbf(files.noMaximal)) mainOf.set(Number(r.COD_VARIAN), Number(r.COD_VAR_01));
  const resolve = (variant: number) => {
    const main = mainOf.get(variant) ?? variant;
    const line = lineOf.get(main) ?? lineOf.get(variant);
    return line ? { line, head: headOf.get(main)?.name ?? headOf.get(variant)?.name ?? "" } : null;
  };

  const unresolved = new Set<number>();
  let trips = 0;
  let skipped = 0;
  const finish = (day: number, frecuencia: number, rows: Row[]) => {
    rows.sort((a, c) => a.part - c.part || a.ordinal - c.ordinal);
    const first = rows[0];
    const last = rows[rows.length - 1];
    if (!first || !last || !(day >= 1 && day <= 3) || !Number.isFinite(frecuencia))
      return void skipped++;
    const route = resolve(first.variant);
    if (!route) {
      unresolved.add(first.variant);
      return void skipped++;
    }
    let base = clock(Math.floor(frecuencia / 10));
    if (base < DAY_START) base += 1440;
    const seq: number[] = [];
    const off: number[] = [];
    let previous = base - WRAP_SLACK;
    for (const row of rows) {
      const at = coords.get(row.stop);
      if (!at || !Number.isFinite(row.hora)) continue;
      let pass = clock(row.hora);
      // Passes only go forward in a trip: a smaller clock time is past midnight.
      while (pass < previous) pass += 1440;
      previous = pass;
      seq.push(
        b.stop({ id: String(row.stop), name: names.get(row.stop) ?? "", lat: at.lat, lon: at.lon }),
      );
      off.push(pass - base);
    }
    if (seq.length < 2) return void skipped++;
    const head = resolve(last.variant)?.head || route.head;
    trips++;
    b.trip(b.route({ line: route.line, head, company: null }), seq, off, day as DayType, base);
  };

  // The rows of one trip are not together in the files (day types interleave), so they
  // are gathered per trip first, as flat numbers to keep the memory small.
  const read = (text: string, circular: boolean) => {
    const trips = new Map<string, number[]>();
    for (const line of lines(text)) {
      const c = line.split(";");
      const n = (i: number) => Number(c[i]);
      const k = `${n(0)}|${n(1)}|${n(2)}`;
      let flat = trips.get(k);
      if (!flat) {
        flat = [];
        trips.set(k, flat);
      }
      if (circular) flat.push(n(3), n(4), n(5), n(6), n(7));
      else flat.push(n(3), n(1), 0, n(4), n(5));
    }
    for (const [k, flat] of trips) {
      const [day, , freq] = k.split("|").map(Number) as [number, number, number];
      const rows: Row[] = [];
      for (let i = 0; i < flat.length; i += 5)
        rows.push({
          stop: flat[i] as number,
          variant: flat[i + 1] as number,
          part: flat[i + 2] as number,
          ordinal: flat[i + 3] as number,
          hora: flat[i + 4] as number,
        });
      finish(day, freq, rows);
    }
  };
  read(files.variante, false);
  read(files.circular, true);
  return {
    feed: b.build("stm", null),
    stats: { trips, skippedTrips: skipped, unresolvedVariants: unresolved.size },
  };
}
