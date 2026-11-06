// Sends the push notifications due for one user (Web Push with VAPID).
import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import type { Preferences, Proposal } from "../../src/model.js";
import { dueNotes, type Note } from "./notify.js";
import type { Env } from "./server.js";

const MAX_LEAD_MINUTES = 120;

interface SubscriptionRow {
  id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Sends what is due; returns the keys sent. Each key goes out at most once. */
export async function notifyUser(
  env: Env,
  admin: SupabaseClient,
  uid: string,
  now: number,
  proposal?: Proposal,
): Promise<string[]> {
  if (!env.vapidPublic || !env.vapidPrivate) return [];
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, keys")
    .eq("user_id", uid);
  if (!subs?.length) return [];
  const { data: settings } = await admin
    .from("settings")
    .select("data, state")
    .eq("user_id", uid)
    .maybeSingle();
  const timeZone =
    (settings?.data as { timezone?: string } | null)?.timezone ?? "America/Montevideo";
  const prefs = (settings?.state as { preferences?: Preferences } | null)?.preferences
    ?.notifications;
  const { data: blocks } = await admin
    .from("plan_blocks")
    .select("id, start_at, tasks(title)")
    .eq("user_id", uid)
    .eq("level", "critical")
    .gt("start_at", new Date(now).toISOString())
    .lte("start_at", new Date(now + MAX_LEAD_MINUTES * 60_000).toISOString());
  const critical = (blocks ?? []).map((b) => ({
    id: b.id as string,
    start: Date.parse(b.start_at as string),
    title: (b.tasks as unknown as { title?: string } | null)?.title ?? "Bloque",
  }));
  const notes = dueNotes({ now, timeZone, prefs, critical, proposal });
  const sent: string[] = [];
  for (const note of notes) {
    const { data: claimed } = await admin.rpc("claim_push", { p_user: uid, p_key: note.key });
    if (!claimed) continue;
    await send(env, admin, subs as SubscriptionRow[], note);
    sent.push(note.key);
  }
  return sent;
}

async function send(
  env: Env,
  admin: SupabaseClient,
  subs: SubscriptionRow[],
  note: Note,
): Promise<void> {
  const payload = JSON.stringify({
    title: note.title,
    body: note.body,
    url: note.url,
    tag: note.key,
  });
  const vapidDetails = {
    subject: env.appUrl ?? "https://critical-cal.vercel.app",
    publicKey: env.vapidPublic as string,
    privateKey: env.vapidPrivate as string,
  };
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, {
        vapidDetails,
        TTL: 60 * 60,
        urgency: "high",
      });
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      // The browser unsubscribed or the app was removed: forget this device.
      if (status === 404 || status === 410) {
        await admin.from("push_subscriptions").delete().eq("id", sub.id);
      } else {
        console.warn("push", status, e);
      }
    }
  }
}

/** Users with at least one device subscribed. */
export async function subscribedUsers(admin: SupabaseClient): Promise<string[]> {
  const { data } = await admin.from("push_subscriptions").select("user_id");
  const users = [...new Set((data ?? []).map((r) => r.user_id as string))];
  // Someone no longer invited gets no notifications (their titles stay unread). A
  // lookup that fails is tried once more; if it still fails that user is skipped this
  // time (never let through) and the failure is logged.
  const invited = await Promise.all(
    users.map(async (uid) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const { data: ok, error } = await admin.rpc("user_invited", { p_user: uid });
        if (!error) return ok === true;
        if (attempt === 1) console.error("push invited lookup", uid, error);
      }
      return false;
    }),
  );
  return users.filter((_, i) => invited[i]);
}
