import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

import type { Syllabus } from "./syllabus.js";

export {
  applyWrites,
  diffData,
  isMissingParent,
  loadData,
  rowsToData,
  type Writes,
  withoutDeleted,
} from "./data.js";

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
  /** Place pairs with no driving route: their time must be entered by hand. */
  unroutable?: { from: string; to: string }[];
  /** Places whose address could not be found. */
  ungeocoded?: string[];
  /** Places without coordinates and without an address. */
  noAddress?: string[];
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

/** At most this many event addresses per call (the geocoder allows one per second). */
export const SPOTS_PER_CALL = 2;
/** Longest wait for the server's answer about event addresses. */
export const SPOTS_TIMEOUT_MS = 45_000;

/** Driving minutes from home to event addresses; null where not found or reachable. */
export async function timeSpots(
  client: SupabaseClient,
  texts: string[],
): Promise<{ ok: boolean; spots?: { text: string; minutes: number | null }[]; error?: string }> {
  try {
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { ok: false, error: "unauthorized" };
    const res = await fetch("/api/travel", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ spots: texts.slice(0, SPOTS_PER_CALL) }),
      // Worst case for two addresses: a home without coordinates and both looked up
      // (8 s each at most, a second apart), then the routes: about 35 s. A stalled
      // answer must not keep the inbox "calculating" for ever.
      signal: AbortSignal.timeout(SPOTS_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      spots?: { text: string; minutes: number | null }[];
      error?: string;
    } | null;
    return body?.ok && Array.isArray(body.spots)
      ? { ok: true, spots: body.spots }
      : { ok: false, error: body?.error ?? "travel_failed" };
  } catch {
    return { ok: false, error: "unreachable" };
  }
}

/** Creates (or revokes) the personal token the Scriptable widget uses. */
export async function widgetToken(
  client: SupabaseClient,
  action: "create" | "revoke",
): Promise<{ ok: boolean; token?: string }> {
  try {
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { ok: false };
    const res = await fetch("/api/widget", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    return (
      ((await res.json().catch(() => null)) as { ok: boolean; token?: string }) ?? { ok: false }
    );
  } catch {
    return { ok: false };
  }
}

export type SyllabusResult =
  | { ok: true; syllabus: Syllabus; model?: string }
  | { ok: false; error: string };

/** Reads a syllabus PDF (base64) with Gemini on the server. */
export async function readSyllabus(client: SupabaseClient, pdf: string): Promise<SyllabusResult> {
  try {
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { ok: false, error: "unauthorized" };
    const res = await fetch("/api/syllabus", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ pdf }),
    });
    const body = (await res.json().catch(() => null)) as SyllabusResult | { error?: string } | null;
    return body && "ok" in body ? body : { ok: false, error: body?.error ?? "syllabus_failed" };
  } catch {
    return { ok: false, error: "unreachable" };
  }
}

export type GeminiKeyResult =
  | { ok: true; own: boolean; fallback?: boolean }
  | { ok: false; error: string };

/** Saves, removes or describes the user's own Gemini key (kept on the server only). */
export async function geminiKey(
  client: SupabaseClient,
  action: "set_key" | "clear_key" | "key_status",
  key?: string,
): Promise<GeminiKeyResult> {
  try {
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { ok: false, error: "unauthorized" };
    const res = await fetch("/api/syllabus", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action, key }),
    });
    const body = (await res.json().catch(() => null)) as
      | GeminiKeyResult
      | { error?: string }
      | null;
    return body && "ok" in body ? body : { ok: false, error: body?.error ?? "key_failed" };
  } catch {
    return { ok: false, error: "unreachable" };
  }
}

export type AccountResult = { ok: true } | { ok: false; error: string; status?: number };

/** «Revocar todo» (`revoke`) or that and deleting the account with all its data (`delete`). */
export async function closeAccount(
  client: SupabaseClient,
  action: "revoke" | "delete",
  deletePlan: boolean,
): Promise<AccountResult> {
  try {
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { ok: false, error: "unauthorized" };
    const res = await fetch("/api/account", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action, deletePlan }),
    });
    const body = (await res.json().catch(() => null)) as AccountResult | { error?: string } | null;
    return body && "ok" in body ? body : { ok: false, error: body?.error ?? "failed" };
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
