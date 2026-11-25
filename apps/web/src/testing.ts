import { vi } from "vitest";
import type { AppData } from "./model.js";
import { reducer } from "./store.js";

// biome-ignore lint/suspicious/noExplicitAny: test mocks of any shape
type Invoke = (name: string, opts: any) => Promise<{ data: unknown; error: unknown }>;

/**
 * Routes the app's `/api/<name>` calls to an `invoke`-style mock and gives the fake
 * Supabase client a session, so tests describe server answers per function name.
 */
export function stubApi(invoke: Invoke): void {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const name = String(url).split("/api/")[1] ?? "";
    const { data } = await invoke(name, { body: JSON.parse(String(init.body ?? "{}")) });
    return Response.json(data);
  });
}

export const session = { getSession: async () => ({ data: { session: { access_token: "tok" } } }) };

/**
 * The habits of `data` as if they had been running since earlier weeks (they ask the whole
 * week, not the share of the days left since they were made), planned again at `now`.
 */
export function runningSince(data: AppData, now: number): AppData {
  const tasks = data.tasks.map((t) => (t.kind === "habit" ? { ...t, createdAt: undefined } : t));
  return reducer({ ...data, tasks }, { type: "refresh", now });
}

/** The filters of Supabase's query builder that the loader chains, for fakes that ignore them. */
export const queryFilters = {
  gt() {
    return this;
  },
  gte() {
    return this;
  },
  lt() {
    return this;
  },
  range() {
    return this;
  },
  limit() {
    return this;
  },
};
