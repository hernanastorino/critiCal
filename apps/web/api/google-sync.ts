// Vercel function (Node): syncs Google Calendar both ways for the calling user.
// 1. stores a new refresh token if the client sends one (right after sign-in),
// 2. imports events from the user's calendars into calendar_events,
// 3. keeps push channels so later changes reach the webhook (production only),
// 4. mirrors future plan_blocks into a single green "📚 Plan" calendar.
import { SyncError } from "./_lib/google-api.js";
import { importGoogle, mirrorPlan, openGoogle, watchCalendars } from "./_lib/google-run.js";
import { report } from "./_lib/report.js";
import { authenticate, type Env, json, readBody, readEnv } from "./_lib/server.js";

/** Vercel entry point. It passes its own second argument, so env is read here. */
export function POST(req: Request): Promise<Response> {
  return handle(req, readEnv());
}

export async function handle(req: Request, env: Env): Promise<Response> {
  const caller = await authenticate(req, env, ["googleClientId", "googleClientSecret"]);
  if (caller instanceof Response) return caller;
  try {
    const body = await readBody(req);
    const session = await openGoogle(caller, env, body.refreshToken);
    if (!session) return json({ connected: false, error: "no_refresh_token" });
    const now = Date.now();
    const result = await importGoogle(session, now);
    if (env.appUrl) {
      // Lets the database's cron reach this deployment.
      await caller.admin.rpc("register_app_url", { p_url: env.appUrl });
      await watchCalendars(session, result.calendarIds, env.appUrl, now);
    }
    const mirrored = await mirrorPlan(session, now, result.planCalendar);
    return json({ connected: true, imported: result.imported, ...mirrored });
  } catch (e) {
    return failure(e, env);
  }
}

export async function failure(e: unknown, env: Env): Promise<Response> {
  // Details stay in the function logs; the client gets a stable code only.
  console.error(e);
  // Expected upstream failures (revoked access, Google outages) are not bugs.
  if (!(e instanceof SyncError)) await report(env, e, "google-sync");
  if (e instanceof SyncError)
    return json({ connected: false, error: e.code, status: e.status, reason: e.reason });
  return json({ connected: false, error: "sync_failed" }, 500);
}
