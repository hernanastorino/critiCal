import { vi } from "vitest";

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
