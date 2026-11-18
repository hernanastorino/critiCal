// Vercel function (Node): receives the browser's Content-Security-Policy reports
// (`report-uri` / `report-to` in vercel.json) and files each one as an error through
// `report`, so it reaches whatever the DSN points at (Sentry or Better Stack, which has no
// CSP endpoint of its own). Answers 204 to anything else.
import { limiter } from "./_lib/rate.js";
import { report } from "./_lib/report.js";
import { type Env, json, readEnv } from "./_lib/server.js";

/** A CSP report is a few hundred bytes; anything bigger is not one. */
export const MAX_BODY = 16_384;

type Violation = { directive?: unknown; blocked?: unknown };

/** The directive and the blocked address, from either report format. */
function violation(raw: unknown): Violation {
  const first = Array.isArray(raw) ? raw[0] : raw;
  const r = (first ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const legacy = r["csp-report"];
  if (legacy) return { directive: legacy["violated-directive"], blocked: legacy["blocked-uri"] };
  const body = r.body ?? {};
  return { directive: body.effectiveDirective, blocked: body.blockedURL };
}

/** One line for the error tracker: «CSP: connect-src blocked https://x.test». */
export function summary(body: string): string {
  let v: Violation = {};
  try {
    v = violation(JSON.parse(body));
  } catch {
    // Not JSON: still worth one generic line.
  }
  const text = (x: unknown) => (typeof x === "string" && x ? x.slice(0, 200) : "?");
  return `CSP: ${text(v.directive)} blocked ${text(v.blocked)}`;
}

export function POST(req: Request): Promise<Response> {
  return handle(req, readEnv());
}

/** Public endpoint: a budget per IP keeps a script from spending the error tracker's quota. */
export const byIp = limiter(20, 200);

const REPORT_TYPE = /^application\/(csp-report|reports\+json|json)\b/i;

function clientIp(req: Request): string {
  const first = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first ? first : "unknown";
}

/** Reads the body unless its own header already says it is too big. */
async function readBody(req: Request): Promise<string> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return "";
  const body = await req.text();
  return body.length > MAX_BODY ? "" : body;
}

export async function handle(req: Request, env: Env): Promise<Response> {
  const done = new Response(null, { status: 204 });
  const type = req.headers.get("content-type") ?? "";
  if (!env.sentryDsn || !REPORT_TYPE.test(type)) return done;
  if (!byIp.take(clientIp(req))) return json({ error: "rate_limited" }, 429);
  const body = await readBody(req);
  if (!body) return done;
  await report(env, { message: summary(body), code: "csp" }, "csp-report");
  return done;
}
