import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
let owner = false;
const channels = [{ id: "ch1", resource_id: "r1" }];

function query(table: string) {
  const data = table === "google_channels" ? channels : null;
  const result = { data, error: null };
  const chain = Promise.resolve(result) as unknown as Promise<typeof result> &
    Record<string, unknown>;
  for (const m of ["select", "eq"]) chain[m] = () => chain;
  chain.maybeSingle = () =>
    Promise.resolve({ data: { google_plan_calendar: "plan-1" }, error: null });
  return chain;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) =>
        token === "good"
          ? { data: { user: { id: "u1" } }, error: null }
          : { data: { user: null }, error: new Error("bad") },
    },
    rpc: (name: string, args: unknown) =>
      name === "user_invited"
        ? Promise.resolve({ data: true, error: null })
        : name === "is_owner"
          ? Promise.resolve({ data: owner, error: null })
          : rpc(name, args),
    from: query,
  }),
}));

const { handle } = await import("./account.js");

const env = {
  url: "https://x.supabase.co",
  publishable: "pk",
  secret: "sk",
  googleClientId: "id",
  googleClientSecret: "secret",
};
const req = (body: object, token = "good") =>
  new Request("https://app/api/account", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

/** Google answers, in the order the function calls them. */
function stubGoogle(token: Response = Response.json({ access_token: "at" })) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push(`${init.method ?? "GET"} ${url}`);
    if (url.includes("oauth2.googleapis.com/token")) return token.clone();
    if (url.includes("calendarList"))
      return Response.json({
        items: [
          { id: "plan-1", summary: "📚 Plan" },
          { id: "plan-2", summary: "📚 Plan" },
          { id: "work", summary: "Trabajo" },
        ],
      });
    return new Response(null, { status: 204 });
  });
  return calls;
}

beforeEach(() => {
  owner = false;
  rpc.mockReset();
  rpc.mockImplementation(async (name: string) =>
    name === "get_oauth_token" ? { data: "refresh", error: null } : { data: null, error: null },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("account", () => {
  it("rejects strangers and unknown actions", async () => {
    expect((await handle(req({ action: "delete" }, "bad"), env)).status).toBe(401);
    expect((await handle(req({ action: "nuke" }), env)).status).toBe(400);
  });

  it("deletes the Plan calendars, stops channels, revokes Google, then the account", async () => {
    const calls = stubGoogle();
    const res = await handle(req({ action: "delete", deletePlan: true }), env);
    expect(await res.json()).toEqual({ ok: true });
    expect(calls).toContain("DELETE https://www.googleapis.com/calendar/v3/calendars/plan-1");
    expect(calls).toContain("DELETE https://www.googleapis.com/calendar/v3/calendars/plan-2");
    expect(calls.some((c) => c.includes("/calendars/work"))).toBe(false);
    expect(calls).toContain("POST https://www.googleapis.com/calendar/v3/channels/stop");
    expect(calls.at(-1)).toBe("POST https://oauth2.googleapis.com/revoke");
    expect(rpc).toHaveBeenLastCalledWith("delete_account", { p_user: "u1" });
  });

  it("keeps the Plan calendar when asked to", async () => {
    const calls = stubGoogle();
    await handle(req({ action: "delete", deletePlan: false }), env);
    expect(calls.some((c) => c.includes("DELETE"))).toBe(false);
    expect(calls).toContain("POST https://oauth2.googleapis.com/revoke");
  });

  it("refuses the owner before touching anything, but lets them revoke", async () => {
    owner = true;
    const calls = stubGoogle();
    const res = await handle(req({ action: "delete", deletePlan: true }), env);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: "owner_cannot_delete" });
    expect(calls).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();

    const revoked = await handle(req({ action: "revoke", deletePlan: false }), env);
    expect(await revoked.json()).toEqual({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith("revoke_connections", { p_user: "u1" });
  });

  it("goes on when Google already revoked the grant", async () => {
    stubGoogle(Response.json({ error: "invalid_grant" }, { status: 400 }));
    const res = await handle(req({ action: "delete", deletePlan: true }), env);
    expect(await res.json()).toEqual({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith("delete_account", { p_user: "u1" });
  });

  it("deletes nothing when Google fails", async () => {
    stubGoogle(Response.json({ error: "server_error" }, { status: 500 }));
    const res = await handle(req({ action: "delete", deletePlan: true }), env);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, error: "token_refresh_failed" });
    expect(rpc).not.toHaveBeenCalledWith("delete_account", expect.anything());
  });

  it("deletes nothing when Google cannot revoke the grant", async () => {
    stubGoogle();
    const calls: string[] = [];
    const google = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      calls.push(url);
      return url.includes("/revoke") ? new Response(null, { status: 503 }) : google(url, init);
    });
    const res = await handle(req({ action: "delete" }), env);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, error: "google_revoke_failed" });
    expect(rpc).not.toHaveBeenCalledWith("delete_account", expect.anything());
  });

  it("deletes nothing when the stored token cannot be read", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "get_oauth_token"
        ? { data: null, error: new Error("db down") }
        : { data: null, error: null },
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await handle(req({ action: "delete" }), env);
    expect(res.status).toBe(500);
    expect(rpc).not.toHaveBeenCalledWith("delete_account", expect.anything());
  });

  it("works without a Google connection", async () => {
    rpc.mockImplementation(async () => ({ data: null, error: null }));
    const calls = stubGoogle();
    const res = await handle(req({ action: "delete" }), env);
    expect(await res.json()).toEqual({ ok: true });
    expect(calls).toEqual([]);
  });

  it("reports a database failure without details", async () => {
    stubGoogle();
    rpc.mockImplementation(async (name: string) =>
      name === "delete_account"
        ? { data: null, error: new Error("db down") }
        : { data: null, error: null },
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await handle(req({ action: "delete" }), env);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "failed" });
  });
});
