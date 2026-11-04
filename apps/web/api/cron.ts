// Vercel function (Node): called by the database every 5 minutes (pg_cron + pg_net).
// Syncs every connected user whose calendars changed (deferred webhooks) or that has
// not been synced for a while: iCloud has no push, and some Google calendars cannot
// be watched. Each run also re-plans and mirrors the Plan calendar, then sends the
// push notifications that are due (every tick, synced or not).
import type { Proposal } from "../src/model.js";
import { notifyUser, subscribedUsers } from "./_lib/push.js";
import { serverSync } from "./_lib/replan.js";
import { report } from "./_lib/report.js";
import { adminClient, type Env, json, missing, readEnv } from "./_lib/server.js";

/** Polling interval for calendars without push (iCloud, unwatched Google ones). */
const GAP = "9 minutes";

export function POST(req: Request): Promise<Response> {
  return handle(req, readEnv());
}

export async function handle(req: Request, env: Env): Promise<Response> {
  if (missing(env).length) return json({ error: "server_not_configured" }, 503);
  const admin = adminClient(env);
  const key = req.headers.get("x-cron-key") ?? "";
  const { data: ok } = await admin.rpc("check_cron_key", { p_key: key });
  if (!key || !ok) return json({ error: "unauthorized" }, 401);

  const { data: users, error } = await admin.rpc("connected_users");
  if (error) throw error;
  const now = Date.now();
  const synced: string[] = [];
  const proposals = new Map<string, Proposal>();
  for (const uid of (users ?? []) as string[]) {
    const { data: claimed } = await admin.rpc("claim_sync", { p_user: uid, p_gap: GAP });
    if (!claimed) continue;
    try {
      const r = await serverSync(env, uid, now);
      if (r.proposal) proposals.set(uid, r.proposal);
      synced.push(uid);
    } catch (e) {
      console.error("cron sync", uid, e);
      await report(env, e, "cron");
    } finally {
      await admin.rpc("finish_sync", { p_user: uid });
    }
  }
  let notified = 0;
  for (const uid of await subscribedUsers(admin)) {
    try {
      notified += (await notifyUser(env, admin, uid, now, proposals.get(uid))).length;
    } catch (e) {
      console.error("cron push", uid, e);
      await report(env, e, "cron-push");
    }
  }
  return json({ ok: true, synced: synced.length, notified });
}
