// Minimal iCalendar (RFC 5545) reader for the VEVENTs CalDAV returns. No imports,
// so both Deno and Vitest can load it.

export interface IcsEvent {
  uid: string;
  recurrenceId?: string;
  summary: string;
  location?: string;
  start: number;
  end: number;
  allDay: boolean;
  busy: boolean;
  cancelled: boolean;
  tentative: boolean;
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Joins folded lines (RFC 5545 §3.1). */
function unfold(text: string): string[] {
  return text
    .replace(/\r\n[ \t]/g, "")
    .replace(/\n[ \t]/g, "")
    .split(/\r?\n/);
}

function parseLine(line: string): Prop | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const [name, ...rawParams] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const [k, v] = p.split("=");
    if (k && v !== undefined) params[k.toUpperCase()] = v.replace(/^"|"$/g, "");
  }
  return { name: (name ?? "").toUpperCase(), params, value: line.slice(colon + 1) };
}

const unescapeText = (v: string) => v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

/** Wall-clock time in `timeZone` → epoch ms. */
export function zoned(
  timeZone: string,
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
): number {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  const offset = (t: number) => {
    const p: Record<string, string> = {};
    for (const x of new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(t)))
      p[x.type] = x.value;
    const n = (k: string) => Number(p[k] ?? 0);
    return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - t;
  };
  const first = naive - offset(naive);
  return naive - offset(first);
}

/** DATE or DATE-TIME value → [epoch ms, isDate]. Floating times use `fallbackTz`. */
export function parseDate(prop: Prop, fallbackTz: string): [number, boolean] {
  const v = prop.value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) throw new Error(`bad date ${v}`);
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map((x) => Number(x ?? 0)) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (m[4] === undefined || prop.params.VALUE === "DATE") {
    return [zoned(fallbackTz, y, mo, d, 0, 0, 0), true];
  }
  if (m[7]) return [Date.UTC(y, mo - 1, d, h, mi, s), false];
  return [zoned(prop.params.TZID ?? fallbackTz, y, mo, d, h, mi, s), false];
}

/** Every VEVENT in an iCalendar document. */
export function parseIcs(text: string, fallbackTz: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  let current: Prop[] | null = null;
  let depth = 0;
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") {
      current = [];
      depth = 0;
      continue;
    }
    if (!current) continue;
    if (line.startsWith("BEGIN:")) depth++;
    else if (line.startsWith("END:") && line !== "END:VEVENT") depth--;
    else if (line === "END:VEVENT") {
      const get = (n: string) => current?.find((p) => p.name === n);
      const dtstart = get("DTSTART");
      if (dtstart) {
        const [start, allDay] = parseDate(dtstart, fallbackTz);
        const dtend = get("DTEND");
        const duration = get("DURATION")?.value;
        let end = dtend ? parseDate(dtend, fallbackTz)[0] : start + (allDay ? 86_400_000 : 0);
        if (!dtend && duration) end = start + parseDuration(duration);
        const rid = get("RECURRENCE-ID");
        events.push({
          uid: get("UID")?.value ?? `${start}`,
          recurrenceId: rid ? String(parseDate(rid, fallbackTz)[0]) : undefined,
          summary: unescapeText(get("SUMMARY")?.value ?? ""),
          location: get("LOCATION")
            ? unescapeText(get("LOCATION")?.value ?? "") || undefined
            : undefined,
          start,
          end,
          allDay,
          busy: get("TRANSP")?.value !== "TRANSPARENT",
          cancelled: get("STATUS")?.value === "CANCELLED",
          tentative: get("STATUS")?.value === "TENTATIVE",
        });
      }
      current = null;
    } else if (depth === 0) {
      const p = parseLine(line);
      if (p) current.push(p);
    }
  }
  return events;
}

/** ISO 8601 duration (P1DT2H30M) → ms. */
export function parseDuration(v: string): number {
  const m = v.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const [, sign, w, d, h, mi, s] = m;
  const ms =
    ((+(w ?? 0) * 7 + +(d ?? 0)) * 86_400 + +(h ?? 0) * 3600 + +(mi ?? 0) * 60 + +(s ?? 0)) * 1000;
  return sign === "-" ? -ms : ms;
}
