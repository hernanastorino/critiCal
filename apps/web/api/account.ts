// Vercel function (Node): «Revocar todo y borrar la cuenta» for the calling user.
//   { action: "revoke", deletePlan } → deletes the «📚 Plan» calendar if asked, revokes
//     Google's grant and forgets every stored secret (Google, iCloud, Gemini, widget).
//   { action: "delete", deletePlan } → the same, then deletes the account and all its
//     data, its invitation included. The owner cannot (403 owner_cannot_delete).
// Google is done first: once the account is gone its refresh token is too.
import { choosePlanCalendar } from "./_lib/google.js";
import { accessToken, google, listCalendars, SyncError, stopChannel } from "./_lib/google-api.js";
import { report } from "./_lib/report.js";
import { authenticate, type Caller, type Env, json, readBody, readEnv } from "./_lib/server.js";

/** Vercel entry point. It passes its own second argument, so env is read here. */
export function POST(req: Request): Promise<Response> {
  return handle(req, readEnv());
}

export async function handle(req: Request, env: Env): Promise<Response> {
  const caller = await authenticate(req, env, []);
  if (caller instanceof Response) return caller;
  const body = await readBody(req);
  if (body.action !== "revoke" && body.action !== "delete") {
    return json({ ok: false, error: "bad_request" }, 400);
  }
  try {
    if (body.action === "delete") {
      // Checked before touching anything: the owner keeps their connections too.
      const { data: owner, error } = await caller.user.rpc("is_owner");
      if (error) throw error;
      if (owner === true) return json({ ok: false, error: "owner_cannot_delete" }, 403);
    }
    const google = await revokeGoogle(caller, env, body.deletePlan === true);
    if (google) return json({ ok: false, error: google.code, status: google.status }, 502);
    const { error } = await caller.admin.rpc(
      body.action === "delete" ? "delete_account" : "revoke_connections",
      { p_user: caller.uid },
    );
    if (error) throw error;
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    await report(env, e, "account");
    return json({ ok: false, error: "failed" }, 500);
  }
}

/**
 * Deletes the Plan calendar (if asked), stops the push channels and revokes the grant.
 * Returns the Google failure that should stop everything, or null to go on: a grant
 * Google already revoked leaves nothing to clean up there.
 */
async function revokeGoogle(
  caller: Caller,
  env: Env,
  deletePlan: boolean,
): Promise<SyncError | null> {
  const { uid, user, admin } = caller;
  const { data: refresh, error } = await admin.rpc("get_oauth_token", {
    p_user: uid,
    p_provider: "google",
  });
  // Unknown is not "not connected": deleting now would lose the token still to revoke.
  if (error) throw error;
  if (typeof refresh !== "string" || !refresh) return null;
  let token: string;
  try {
    token = await accessToken(env, refresh);
  } catch (e) {
    if (e instanceof SyncError && e.reason === "invalid_grant") return null;
    if (e instanceof SyncError) return e;
    throw e;
  }
  try {
    if (deletePlan) {
      const { data: row } = await user
        .from("settings")
        .select("google_plan_calendar")
        .maybeSingle();
      const plan = choosePlanCalendar(await listCalendars(token), row?.google_plan_calendar);
      for (const id of [...(plan.keep ? [plan.keep.id] : []), ...plan.remove]) {
        await google(token, `/calendars/${encodeURIComponent(id)}`, { method: "DELETE" });
      }
    }
  } catch (e) {
    if (e instanceof SyncError) return e;
    throw e;
  }
  const { data: channels } = await admin
    .from("google_channels")
    .select("id, resource_id")
    .eq("user_id", uid);
  for (const c of (channels ?? []) as { id: string; resource_id: string }[]) {
    await stopChannel(token, c.id, c.resource_id).catch(() => undefined);
  }
  // Revokes the refresh token and every access token of the grant. An already revoked
  // token answers 400, which is just as done.
  const res = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refresh }),
  });
  // Anything else (rate limits, outages) leaves the grant alive: keep the token to retry.
  if (!res.ok && res.status !== 400) return new SyncError("google_revoke_failed", res.status);
  return null;
}
