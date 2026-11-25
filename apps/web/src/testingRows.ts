import { vi } from "vitest";
import { queryFilters, session, stubApi } from "./testing.js";

type Row = Record<string, unknown>;

export interface Request {
  table: string;
  /** The filters of the request: `lt:start_at`, `gt:end_at`… with the value asked. */
  filters: Record<string, string>;
  from: number;
  rows: number;
}

/**
 * A Supabase stand-in that really filters, orders and pages the rows it holds (max 1000 per
 * request, like the server), so loading code is tested against what it asks, not what it gets.
 * `gate` may hold back a request until the test lets it go.
 */
export function rowsClient(
  tables: Record<string, Row[]>,
  options: { gate?: (r: Omit<Request, "rows">) => Promise<void> | undefined } = {},
) {
  const requests: Request[] = [];
  const writes: { op: string; table: string }[] = [];
  const from = (table: string) => ({
    select: (columns = "*") => {
      const filters: Record<string, string> = {};
      const sorts: { col: string; sign: number }[] = [];
      let window: [number, number] = [0, 999];
      let limit = 1000;
      const result = async () => {
        const wait = options.gate?.({ table, filters: { ...filters }, from: window[0] });
        if (wait) await wait;
        let rows = (tables[table] ?? []).filter((r) =>
          Object.entries(filters).every(([k, v]) => {
            const [op, key] = k.split(":") as [string, string];
            const cell = String(r[key]);
            return op === "gt" ? cell > v : op === "gte" ? cell >= v : cell < v;
          }),
        );
        rows = [...rows].sort((a, b) => {
          for (const s of sorts) {
            const [x, y] = [String(a[s.col]), String(b[s.col])];
            if (x !== y) return (x < y ? -1 : 1) * s.sign;
          }
          return 0;
        });
        const page = rows.slice(window[0], Math.min(window[1] + 1, window[0] + limit));
        requests.push({ table, filters: { ...filters }, from: window[0], rows: page.length });
        const projected =
          columns === "*" ? page : page.map((r) => Object.fromEntries([[columns, r[columns]]]));
        return { data: projected.slice(0, 1000), error: null };
      };
      const query = {
        ...queryFilters,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        order(col: string, o?: { ascending?: boolean }) {
          sorts.push({ col, sign: o?.ascending === false ? -1 : 1 });
          return query;
        },
        range(a: number, b: number) {
          window = [a, b];
          return query;
        },
        limit(n: number) {
          limit = n;
          return query;
        },
        gt(c: string, v: string) {
          filters[`gt:${c}`] = v;
          return query;
        },
        gte(c: string, v: string) {
          filters[`gte:${c}`] = v;
          return query;
        },
        lt(c: string, v: string) {
          filters[`lt:${c}`] = v;
          return query;
        },
        // biome-ignore lint/suspicious/noThenProperty: the real builder is thenable too
        then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) =>
          result().then(ok, fail),
      };
      return query;
    },
    upsert: () => {
      writes.push({ op: "upsert", table });
      return Promise.resolve({ error: null });
    },
    insert: () => {
      writes.push({ op: "insert", table });
      return Promise.resolve({ error: null });
    },
    delete: () => ({
      in: () => {
        writes.push({ op: "delete", table });
        return Promise.resolve({ error: null });
      },
    }),
  });
  const invoke = vi.fn(async () => ({ data: { connected: true }, error: null }));
  stubApi(invoke);
  return { client: { from, auth: session } as never, requests, writes };
}
