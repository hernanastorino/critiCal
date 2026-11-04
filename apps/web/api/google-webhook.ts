// Vercel function (Node): Google Calendar push notifications. Each one names a channel
// created by the sync; a change re-syncs that user's calendars and re-plans right away.
import { serverSync } from "./_lib/replan.js";
import { adminClient, type Env, json, missing, readEnv } from "./_lib/server.js";

/** Bursts of notifications (one per edited event) share one sync. */
const GAP = "20 seconds";

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
  const { data: channel } = await admin
    .from("google_channels")
    .select("user_id, secret")
    .eq("id", id)
    .maybeSingle();
  // Unknown or forged: Google stops sending to channels that answer 404.
  if (!channel || channel.secret !== secret) return json({ error: "unknown_channel" }, 404);
  // The first message only confirms the channel.
  if (state === "sync") return json({ ok: true });
  const { data: claimed, error } = await admin.rpc("claim_sync", {
    p_user: channel.user_id,
    p_gap: GAP,
  });
  if (error) throw error;
  if (!claimed) return json({ ok: true, deferred: true });
  try {
    const r = await serverSync(env, channel.user_id as string);
    return json({ ok: true, proposal: !!r.proposal });
  } catch (e) {
    // Answer 200 anyway: a retry storm would not help, the next tick syncs again.
    console.error("webhook sync", e);
    return json({ ok: false });
  }
}
