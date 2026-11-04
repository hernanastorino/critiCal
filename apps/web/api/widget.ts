// Vercel function (Node): the Scriptable widget's data, and its personal token.
//   GET  with "Authorization: Bearer <widget token>" → the silos as JSON.
//   POST as the signed-in user {action: "create" | "revoke"} → a new token (shown once).
import { loadData } from "../src/data.js";
import { report } from "./_lib/report.js";
import {
  actAs,
  adminClient,
  authenticate,
  type Env,
  json,
  missing,
  readBody,
  readEnv,
} from "./_lib/server.js";
import { sha256, widgetSilos } from "./_lib/widget.js";

export function GET(req: Request): Promise<Response> {
  return read(req, readEnv());
}

export function POST(req: Request): Promise<Response> {
  return manage(req, readEnv());
}

export async function read(req: Request, env: Env, now = Date.now()): Promise<Response> {
  if (missing(env).length) return json({ error: "server_not_configured" }, 503);
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "unauthorized" }, 401);
  const admin = adminClient(env);
  const { data: uid, error: lookup } = await admin.rpc("widget_user", {
    p_hash: await sha256(token),
  });
  // A failed lookup is our problem, not a bad token.
  if (lookup) {
    console.error(lookup);
    await report(env, lookup, "widget");
    return json({ error: "widget_failed" }, 500);
  }
  if (!uid) return json({ error: "unauthorized" }, 401);
  let caller: Awaited<ReturnType<typeof actAs>> | undefined;
  try {
    caller = await actAs(env, uid as string);
    const data = await loadData(caller.user);
    return json({ updatedAt: now, silos: widgetSilos(data, now) });
  } catch (e) {
    console.error(e);
    await report(env, e, "widget");
    return json({ error: "widget_failed" }, 500);
  } finally {
    await caller?.release?.().catch(() => {});
  }
}

export async function manage(req: Request, env: Env): Promise<Response> {
  const caller = await authenticate(req, env, []);
  if (caller instanceof Response) return caller;
  const body = await readBody(req);
  if (body.action === "revoke") {
    const { error } = await caller.admin.rpc("revoke_widget_token", { p_user: caller.uid });
    if (error) return json({ ok: false, error: "widget_failed" }, 500);
    return json({ ok: true });
  }
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = `cw_${Buffer.from(bytes).toString("base64url")}`;
  const { error } = await caller.admin.rpc("set_widget_token", {
    p_user: caller.uid,
    p_hash: await sha256(token),
  });
  if (error) return json({ error: "widget_failed" }, 500);
  return json({ ok: true, token });
}
