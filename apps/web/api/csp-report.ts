// Vercel function (Node): receives the browser's Content-Security-Policy reports
// (`report-uri` / `report-to` in vercel.json) and passes them to Sentry's security
// endpoint, so the key never needs to be in the repo. Answers 204 to anything else.
import { limiter } from "./_lib/rate.js";
import { report } from "./_lib/report.js";
import { type Env, json, readEnv } from "./_lib/server.js";

/** A CSP report is a few hundred bytes; anything bigger is not one. */
export const MAX_BODY = 16_384;

/** Sentry's CSP endpoint for a DSN: `https://<key>@<host>/<project>`. */
export function securityUrl(dsn: string): string | null {
  const m = /^https:\/\/([^@]+)@([^/]+)\/(\d+)$/.exec(dsn.trim());
  return m ? `https://${m[2]}/api/${m[3]}/security/?sentry_key=${m[1]}` : null;
}

export function POST(req: Request): Promise<Response> {
  return handle(req, readEnv());
}

/** Public endpoint: a budget per IP keeps a script from spending the Sentry quota. */
export const byIp = limiter(20, 200);

export async function handle(req: Request, env: Env): Promise<Response> {
  const done = new Response(null, { status: 204 });
  const target = env.sentryDsn ? securityUrl(env.sentryDsn) : null;
  const type = req.headers.get("content-type") ?? "";
  if (!target || !/^application\/(csp-report|reports\+json|json)\b/i.test(type)) return done;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!byIp.take(ip)) return json({ error: "rate_limited" }, 429);
  // Too big by its own header: not read at all.
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return done;
  const body = await req.text();
  if (!body || body.length > MAX_BODY) return done;
  try {
    await fetch(target, {
      method: "POST",
      signal: AbortSignal.timeout(3000),
      headers: { "Content-Type": type, "User-Agent": req.headers.get("user-agent") ?? "" },
      body,
    });
  } catch (e) {
    await report(env, e, "csp-report");
  }
  return done;
}
