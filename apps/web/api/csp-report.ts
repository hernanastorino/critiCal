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

/**
 * The endpoint is public: what it files is whatever a stranger sent, so only the shapes a browser
 * really sends get through («connect-src», «https://x.test/a?b»); anything else is «?».
 */
const DIRECTIVE = /^[a-z][a-z0-9-]{0,40}$/;
const directive = (x: unknown) => (typeof x === "string" && DIRECTIVE.test(x) ? x : "?");
/** A blocked address or keyword («inline», «eval», «data», a URL): no spaces or control characters. */
const BLOCKED = /^[^\s\p{C}]{1,200}$/u;
const blocked = (x: unknown) => {
  if (typeof x !== "string") return "?";
  const first = x.slice(0, 200);
  return BLOCKED.test(first) ? first : "?";
};

/** One line for the error tracker: «CSP: connect-src blocked https://x.test». */
export function summary(body: string): string {
  let v: Violation = {};
  try {
    v = violation(JSON.parse(body));
  } catch {
    // Not JSON: still worth one generic line.
  }
  return `CSP: ${directive(v.directive)} blocked ${blocked(v.blocked)}`;
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

/**
 * Reads the body unless it is too big: by its own header when it has one and, since a chunked
 * request has none, by counting what comes in (it stops reading at the limit).
 */
async function readBody(req: Request): Promise<string> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return "";
  const reader = req.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for (let part = await reader.read(); !part.done; part = await reader.read()) {
    size += part.value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      return "";
    }
    text += decoder.decode(part.value, { stream: true });
  }
  return text + decoder.decode();
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
