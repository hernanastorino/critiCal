import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export interface Env {
  url?: string;
  publishable?: string;
  secret?: string;
  googleClientId?: string;
  googleClientSecret?: string;
}

export function readEnv(e: NodeJS.ProcessEnv = process.env): Env {
  return {
    url: e.SUPABASE_URL || e.VITE_SUPABASE_URL,
    publishable: e.SUPABASE_PUBLISHABLE_KEY || e.VITE_SUPABASE_PUBLISHABLE_KEY,
    secret: e.SUPABASE_SECRET_KEY,
    googleClientId: e.GOOGLE_CLIENT_ID,
    googleClientSecret: e.GOOGLE_CLIENT_SECRET,
  };
}

export interface Caller {
  uid: string;
  /** Acts as the user: RLS applies. */
  user: SupabaseClient;
  /** Service role: only for the token functions. */
  admin: SupabaseClient;
}

/**
 * Authenticates the request's bearer token. Returns a Response to send back when
 * the server is not configured (503, so the client falls back) or the caller is
 * not signed in (401).
 */
export async function authenticate(
  req: Request,
  env: Env,
  needs: (keyof Env)[],
): Promise<Caller | Response> {
  const missing = (["url", "publishable", "secret", ...needs] as (keyof Env)[]).filter(
    (k) => !env[k],
  );
  if (missing.length) {
    // Names only, never values: tells the operator which variable to set.
    return json({ error: "server_not_configured", missing }, 503);
  }
  const url = env.url as string;
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "unauthorized" }, 401);
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, env.secret as string, options);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return json({ error: "unauthorized" }, 401);
  const user = createClient(url, env.publishable as string, {
    ...options,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return { uid: data.user.id, user, admin };
}

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  if (!req.headers.get("content-type")?.includes("json")) return {};
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function timeZoneOf(user: SupabaseClient): Promise<string> {
  const { data } = await user.from("settings").select("data").maybeSingle();
  return (data?.data as { timezone?: string } | null)?.timezone ?? "America/Montevideo";
}

/** Deletes rows by external id in batches (one huge `in (...)` overflows the URL and fails). */
export async function deleteByExternalId(
  user: SupabaseClient,
  source: string,
  ids: string[],
): Promise<void> {
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await user
      .from("calendar_events")
      .delete()
      .eq("source", source)
      .in("external_id", ids.slice(i, i + 100));
    if (error) throw error;
  }
}

/** Forgets calendars (and their events) that the source no longer lists. */
export async function pruneCalendars(
  user: SupabaseClient,
  source: string,
  keep: string[],
): Promise<void> {
  const list = `(${keep.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(",")})`;
  const events = user.from("calendar_events").delete().eq("source", source);
  const calendars = user.from("calendars").delete().eq("source", source);
  const [a, b] = await Promise.all(
    keep.length
      ? [events.not("calendar_id", "in", list), calendars.not("external_id", "in", list)]
      : [events, calendars],
  );
  if (a.error) throw a.error;
  if (b.error) throw b.error;
}
