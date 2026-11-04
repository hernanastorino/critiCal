import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

export { applyWrites, diffData, loadData, rowsToData, type Writes } from "./data.js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;

export const GOOGLE_SCOPES = "https://www.googleapis.com/auth/calendar";

export async function signInWithGoogle(client: SupabaseClient): Promise<void> {
  await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      scopes: GOOGLE_SCOPES,
      redirectTo: window.location.origin,
      queryParams: { access_type: "offline", prompt: "consent" },
    },
  });
}

export interface SyncResult {
  connected: boolean;
  imported?: number;
  error?: string;
  status?: number;
  /** Upstream error code, e.g. Google's "invalid_client". */
  reason?: string;
}

/** Runs the iCloud sync, or connects/disconnects iCloud. */
/** Calls one of this site's sync functions (Vercel, Node) as the signed-in user. */
async function callSync(client: SupabaseClient, name: string, body: object): Promise<SyncResult> {
  try {
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { connected: false, error: "unauthorized" };
    const res = await fetch(`/api/${name}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await res.json().catch(() => null)) as SyncResult | null;
    return result && "connected" in result
      ? result
      : { connected: false, error: "sync_failed", status: res.status };
  } catch {
    return { connected: false, error: "unreachable" };
  }
}

export interface TravelResult {
  ok: boolean;
  geocoded?: number;
  pairs?: number;
  error?: string;
}

/** Geocodes saved places and computes driving times between them (OpenRouteService). */
export async function computeTravel(client: SupabaseClient): Promise<TravelResult> {
  try {
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { ok: false, error: "unauthorized" };
    const res = await fetch("/api/travel", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    });
    const body = (await res.json().catch(() => null)) as TravelResult | { error?: string } | null;
    return body && "ok" in body ? body : { ok: false, error: body?.error ?? "travel_failed" };
  } catch {
    return { ok: false, error: "unreachable" };
  }
}

export function syncICloud(
  client: SupabaseClient,
  body: { action?: "connect" | "disconnect"; appleId?: string; appPassword?: string } = {},
): Promise<SyncResult> {
  return callSync(client, "icloud-sync", body);
}

/** Runs the server sync; passes the Google refresh token right after sign-in. */
let googleInFlight: Promise<SyncResult> | null = null;

/** One Google sync at a time: overlapping calls share the running one. */
export function syncGoogle(client: SupabaseClient, session: Session): Promise<SyncResult> {
  googleInFlight ??= (async () => {
    try {
      return await callSync(client, "google-sync", {
        refreshToken: session.provider_refresh_token ?? null,
      });
    } finally {
      googleInFlight = null;
    }
  })();
  return googleInFlight;
}
