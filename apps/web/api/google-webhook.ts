// Vercel function (Node): Google Calendar push notifications. Each one names a channel
// created by the sync; a change re-syncs that user's calendars and re-plans right away.
import { timingSafeEqual } from "node:crypto";
import { notifyUser } from "./_lib/push.js";
import { serverSync } from "./_lib/replan.js";
import { report } from "./_lib/report.js";
import { adminClient, type Env, json, missing, readEnv } from "./_lib/server.js";

/** Bursts of notifications (one per edited event) share one sync. */
const GAP = "20 seconds";

/** Same secret, compared in constant time (a different length is already different). */
function sameSecret(given: string, stored: unknown): boolean {
  if (typeof stored !== "string") return false;
  const [a, b] = [Buffer.from(given), Buffer.from(stored)];
  return a.length === b.length && timingSafeEqual(a, b);
}

export function POST(req: Request): Promise<Response> {
  return handle(req, readEnv());
}

export async function handle(req: Request, env: Env): Promise<Response> {
  if (missing(env, ["googleClientId", "googleClientSecret"]).length)
    return json({ error: "server_not_configured" }, 503);
  const id = req.headers.get("x-goog-channel-id");
  const secret = req.headers.get("x-goog-channel-token");
  const state = req.headers.get("x-goog-resource-state");
  if (!id || !secret) return json({ error: "bad_request" }, 400);
  const admin = adminClient(env);
  const { data: channel, error: lookupError } = await admin
    .from("google_channels")
    .select("user_id, secret")
    .eq("id", id)
    .maybeSingle();
  // A failed lookup is not an unknown channel: answering 404 would make Google drop it.
  if (lookupError) {
    await report(env, lookupError, "google-webhook");
    return json({ error: "lookup_failed" }, 500);
  }
  // Unknown or forged: Google stops sending to channels that answer 404.
  if (!channel || !sameSecret(secret, channel.secret))
    return json({ error: "unknown_channel" }, 404);
  // The first message only confirms the channel.
  if (state === "sync") return json({ ok: true });
  const { data: claimed, error } = await admin.rpc("claim_sync", {
    p_user: channel.user_id,
    p_gap: GAP,
  });
  if (error) {
    await report(env, error, "google-webhook");
    return json({ ok: false, error: "claim_failed" }, 500);
  }
  if (!claimed) return json({ ok: true, deferred: true });
  try {
    const r = await serverSync(env, channel.user_id as string);
    // A clash with today's plan is worth telling right away, not at the next tick.
    if (r.proposal) await notifyUser(env, admin, channel.user_id as string, Date.now(), r.proposal);
    return json({ ok: true, proposal: !!r.proposal });
  } catch (e) {
    // Answer 200 anyway: a retry storm would not help, the next tick syncs again.
    console.error("webhook sync", e);
    await report(env, e, "google-webhook");
    return json({ ok: false });
  } finally {
    await admin.rpc("finish_sync", { p_user: channel.user_id });
  }
}
