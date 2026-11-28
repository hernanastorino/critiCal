import type { SupabaseClient } from "@supabase/supabase-js";
import { queryFilters, session, stubApi } from "./testing.js";

// A Supabase stand-in that keeps what is written: upserts merge by the table's key, inserts
// check the keys and the places a route points at, deletes cascade from places to routes. It
// reads what the app asks for the way PostgREST does (filters, order, ranges). For tests that
// go from one account to another through the real loading and saving code.

export type Row = Record<string, unknown>;

const KEYS = new Map<string, string[]>([
  ["settings", ["user_id"]],
  ["calendars", ["source", "external_id"]],
  ["calendar_events", ["source", "external_id"]],
  ["day_overrides", ["date"]],
  ["travel_times", ["from_place", "to_place"]],
  ["meal_runs", ["meal", "weekday", "from_date"]],
]);

const cell = (row: Row, col: string): unknown => new Map(Object.entries(row)).get(col);
const keyOf = (table: string, row: Row): string =>
  (KEYS.get(table) ?? ["id"]).map((c) => String(cell(row, c))).join("|");

let counter = 0;
const uuid = () => {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
};

/** The error PostgREST gives for a foreign key or a unique index. */
const refused = (code: string) => ({ error: { code, message: `refused ${code}` } });

export function dbClient(userId: string, tables: Map<string, Row[]> = new Map()) {
  const rowsOf = (table: string): Row[] => {
    const rows = tables.get(table) ?? [];
    tables.set(table, rows);
    return rows;
  };
  const writes: { op: string; table: string; rows: number }[] = [];

  const slot = (r: Row) =>
    [r.from_place, r.to_place, r.weekday ?? 0, r.mode, r.time_minutes].join("|");

  /** A row going into `table`: its defaults, and what the database would refuse about it. */
  const accept = (
    table: string,
    input: Row,
    inserting: boolean,
  ): { row: Row } | { code: string } => {
    const row: Row = { user_id: userId, ...input };
    if (inserting && !KEYS.has(table) && cell(row, "id") === undefined) row.id = uuid();
    if (table === "bus_routes") {
      const places = new Set(rowsOf("places").map((p) => p.id));
      if (!places.has(row.from_place) || !places.has(row.to_place)) return { code: "23503" };
      if (rowsOf("bus_routes").some((r) => slot(r) === slot(row))) return { code: "23505" };
    }
    if (table === "calendar_events" && !["google", "icloud"].includes(String(row.source))) {
      return { code: "23514" };
    }
    return { row };
  };

  const write = (table: string, input: Row | Row[], inserting: boolean, ignore = false) => {
    const list = Array.isArray(input) ? input : [input];
    writes.push({ op: inserting ? "insert" : "upsert", table, rows: list.length });
    const rows = rowsOf(table);
    for (const one of list) {
      const taken = accept(table, one, inserting);
      if ("code" in taken) return Promise.resolve(refused(taken.code));
      const { row } = taken;
      const at = rows.findIndex((r) => keyOf(table, r) === keyOf(table, row));
      if (at < 0) rows.push(row);
      else if (!ignore) rows[at] = { ...rows.at(at), ...row };
    }
    return Promise.resolve({ error: null });
  };

  const remove = (table: string) => {
    const tests: ((r: Row) => boolean)[] = [];
    const run = () => {
      const rows = rowsOf(table);
      const gone = rows.filter((r) => tests.every((t) => t(r)));
      tables.set(
        table,
        rows.filter((r) => !gone.includes(r)),
      );
      writes.push({ op: "delete", table, rows: gone.length });
      // Foreign keys that cascade: a materia takes its tareas; a tarea its parts, blocks and records.
      const cascade = (parent: string, child: string, col: string) => {
        const ids = new Set(gone.map((r) => r.id));
        const kids = rowsOf(child).filter((r) => ids.has(r[col]));
        if (kids.length) {
          tables.set(
            child,
            rowsOf(child).filter((r) => !kids.includes(r)),
          );
          if (child === "tasks") cascadeTasks(kids);
        }
        return parent;
      };
      const cascadeTasks = (tasks: Row[]) => {
        const ids = new Set(tasks.map((t) => t.id));
        for (const child of ["task_units", "plan_blocks", "check_ins"]) {
          tables.set(
            child,
            rowsOf(child).filter((r) => !ids.has(r.task_id)),
          );
        }
      };
      if (table === "activities") cascade(table, "tasks", "activity_id");
      if (table === "tasks") cascadeTasks(gone);
      if (table === "places") {
        const ids = new Set(gone.map((p) => p.id));
        tables.set(
          "travel_times",
          rowsOf("travel_times").filter((r) => !ids.has(r.from_place) && !ids.has(r.to_place)),
        );
        tables.set(
          "bus_routes",
          rowsOf("bus_routes").filter((r) => !ids.has(r.from_place) && !ids.has(r.to_place)),
        );
      }
      return { error: null };
    };
    const query = {
      in(col: string, values: unknown[]) {
        tests.push((r) => values.includes(cell(r, col)));
        return query;
      },
      eq(col: string, value: unknown) {
        tests.push((r) => cell(r, col) === value);
        return query;
      },
      neq(col: string, value: unknown) {
        tests.push((r) => cell(r, col) !== value);
        return query;
      },
      // biome-ignore lint/suspicious/noThenProperty: the real builder is thenable too
      then: (
        ok: Parameters<Promise<unknown>["then"]>[0],
        fail: Parameters<Promise<unknown>["then"]>[1],
      ) => Promise.resolve(run()).then(ok, fail),
    };
    return query;
  };

  const select = (columns = "*") => {
    const filters: [string, string, string][] = [];
    const sorts: { col: string; sign: number }[] = [];
    let window: [number, number] = [0, 999];
    let limit = 1000;
    const rows = (table: string) =>
      [...rowsOf(table)]
        .filter((r) =>
          filters.every(([op, col, v]) => {
            const c = String(cell(r, col));
            return op === "gt" ? c > v : op === "gte" ? c >= v : c < v;
          }),
        )
        .sort((a, b) => {
          for (const s of sorts) {
            const [x, y] = [String(cell(a, s.col)), String(cell(b, s.col))];
            if (x !== y) return (x < y ? -1 : 1) * s.sign;
          }
          return 0;
        });
    return (table: string) => {
      const query = {
        ...queryFilters,
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
          filters.push(["gt", c, v]);
          return query;
        },
        gte(c: string, v: string) {
          filters.push(["gte", c, v]);
          return query;
        },
        lt(c: string, v: string) {
          filters.push(["lt", c, v]);
          return query;
        },
        maybeSingle: () => Promise.resolve({ data: rows(table).at(0) ?? null, error: null }),
        // biome-ignore lint/suspicious/noThenProperty: the real builder is thenable too
        then: (
          ok: Parameters<Promise<unknown>["then"]>[0],
          fail: Parameters<Promise<unknown>["then"]>[1],
        ) => {
          const page = rows(table).slice(window[0], Math.min(window[1] + 1, window[0] + limit));
          const wanted = columns.split(",").map((c) => c.trim());
          const data =
            columns === "*"
              ? page
              : page.map((r) => Object.fromEntries(wanted.map((c) => [c, cell(r, c)])));
          return Promise.resolve({ data, error: null }).then(ok, fail);
        },
      };
      return query;
    };
  };

  const from = (table: string) => ({
    select: (columns?: string) => select(columns)(table),
    upsert: (rows: Row | Row[], options?: { ignoreDuplicates?: boolean }) =>
      write(table, rows, false, options?.ignoreDuplicates),
    insert: (rows: Row | Row[]) => write(table, rows, true),
    delete: () => remove(table),
  });
  const rpc = (name: string) =>
    Promise.resolve(
      name === "server_now"
        ? { data: new Date().toISOString(), error: null }
        : { data: null, error: new Error(name) },
    );
  stubApi(() => Promise.resolve({ data: { connected: true }, error: null }));
  return {
    client: { from, rpc, auth: session } as unknown as SupabaseClient,
    tables,
    rows: rowsOf,
    writes,
  };
}
