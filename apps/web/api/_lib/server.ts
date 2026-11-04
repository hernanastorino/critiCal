import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export interface Env {
  url?: string;
  publishable?: string;
  secret?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  /** Public origin of the production deployment; webhooks and cron only run there. */
  appUrl?: string;
  vapidPublic?: string;
  vapidPrivate?: string;
  sentryDsn?: string;
  /** OpenRouteService key for driving times. */
  orsKey?: string;
  /** Google AI Studio key for reading syllabus PDFs. */
  geminiKey?: string;
  geminiModel?: string;
}

export function readEnv(e: NodeJS.ProcessEnv = process.env): Env {
  return {
    url: e.SUPABASE_URL || e.VITE_SUPABASE_URL,
    publishable: e.SUPABASE_PUBLISHABLE_KEY || e.VITE_SUPABASE_PUBLISHABLE_KEY,
    secret: e.SUPABASE_SECRET_KEY,
    googleClientId: e.GOOGLE_CLIENT_ID,
    googleClientSecret: e.GOOGLE_CLIENT_SECRET,
    appUrl:
      e.VERCEL_ENV === "production" && e.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${e.VERCEL_PROJECT_PRODUCTION_URL}`
        : undefined,
    vapidPublic: e.VITE_VAPID_PUBLIC_KEY,
    vapidPrivate: e.VAPID_PRIVATE_KEY,
    sentryDsn: e.SENTRY_DSN || e.VITE_SENTRY_DSN,
    orsKey: e.ORS_API_KEY,
    geminiKey: e.GEMINI_API_KEY,
    geminiModel: e.GEMINI_MODEL,
  };
}

export interface Caller {
  uid: string;
  /** Acts as the user: RLS applies. */
  user: SupabaseClient;
  /** Service role: only for the token functions. */
  admin: SupabaseClient;
  /** Ends a session opened by `actAs`. */
  release?: () => Promise<void>;
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
  const unset = missing(env, needs);
  if (unset.length) {
    // Names only, never values: tells the operator which variable to set.
    return json({ error: "server_not_configured", missing: unset }, 503);
  }
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "unauthorized" }, 401);
  const admin = adminClient(env);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return json({ error: "unauthorized" }, 401);
  return { uid: data.user.id, user: userClient(env, token), admin };
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };

/** Service role; callers must check `missing(env)` first. */
export function adminClient(env: Env): SupabaseClient {
  return createClient(env.url as string, env.secret as string, options);
}

function userClient(env: Env, token: string): SupabaseClient {
  return createClient(env.url as string, env.publishable as string, {
    ...options,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/** Names of the variables still to set for these features. */
export function missing(env: Env, needs: (keyof Env)[] = []): (keyof Env)[] {
  return (["url", "publishable", "secret", ...needs] as (keyof Env)[]).filter((k) => !env[k]);
}

/**
 * Acts as a user without their request (webhooks, cron), so RLS and column defaults
 * (`user_id = auth.uid()`) apply exactly as when the app calls: a one-time sign-in
 * link is minted and redeemed server-side for a short-lived session.
 */
export async function actAs(env: Env, uid: string): Promise<Caller> {
  const admin = adminClient(env);
  const { data: found, error: lookup } = await admin.auth.admin.getUserById(uid);
  const email = found?.user?.email;
  if (lookup || !email) throw lookup ?? new Error("user_without_email");
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError) throw linkError;
  const anon = createClient(env.url as string, env.publishable as string, options);
  const { data, error } = await anon.auth.verifyOtp({
    type: "email",
    token_hash: link.properties.hashed_token,
  });
  if (error || !data.session) throw error ?? new Error("no_session");
  const jwt = data.session.access_token;
  return {
    uid,
    user: userClient(env, jwt),
    admin,
    // Revoke this one session so server syncs do not pile up refresh tokens.
    release: async () => {
      await admin.auth.admin.signOut(jwt, "local");
    },
  };
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
  // PostgREST list literal: backslashes first, then quotes.
  const quote = (id: string) => `"${id.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const list = `(${keep.map(quote).join(",")})`;
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
