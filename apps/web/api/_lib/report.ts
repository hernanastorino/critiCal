// Sends server errors to Sentry through its envelope endpoint, without the SDK (which
// would add OpenTelemetry and seconds of cold start to every function).
import type { Env } from "./server.js";

export function parseDsn(dsn: string): { url: string; key: string } | null {
  const m = /^https:\/\/([^@]+)@([^/]+)\/(\d+)$/.exec(dsn.trim());
  if (!m) return null;
  return { url: `https://${m[2]}/api/${m[3]}/envelope/`, key: m[1] as string };
}

/**
 * An Error to describe, and the type to file it under: a database code ("42501") when
 * there is one, Error or not (Supabase errors come both ways).
 */
function describe(error: unknown): { err: Error; type: string } {
  const e = error as { message?: unknown; code?: unknown } | null;
  const err =
    error instanceof Error
      ? error
      : new Error(typeof e?.message === "string" ? e.message : String(error));
  const code = typeof e?.code === "string" && e.code ? e.code : undefined;
  return { err, type: code ?? err.name };
}

/** Reports an error; never throws, so it is safe inside catch blocks. */
export async function report(env: Env, error: unknown, where: string): Promise<void> {
  const dsn = env.sentryDsn ? parseDsn(env.sentryDsn) : null;
  if (!dsn) return;
  const { err, type } = describe(error);
  const eventId = crypto.randomUUID().replace(/-/g, "");
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: "node",
    level: "error",
    environment: process.env.VERCEL_ENV ?? "development",
    tags: { function: where },
    exception: {
      values: [{ type, value: err.message, stacktrace: undefined }],
    },
    extra: { stack: err.stack },
  };
  const body = [
    JSON.stringify({ event_id: eventId, dsn: env.sentryDsn }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
  try {
    await fetch(dsn.url, {
      method: "POST",
      // A stalled Sentry must not hold up the cron or the webhook.
      signal: AbortSignal.timeout(3000),
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=critical/1.0`,
      },
      body,
    });
  } catch {
    // Reporting must never break the function.
  }
}
