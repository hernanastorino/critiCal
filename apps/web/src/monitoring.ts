// Error reporting to Sentry, only when a DSN is configured. The SDK is loaded lazily so
// it costs nothing otherwise.

type Capture = (e: unknown, extra?: Record<string, string>) => void;
let capture: Capture | null = null;

export async function startMonitoring(): Promise<void> {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn || capture) return;
  const Sentry = await import("@sentry/browser");
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // Errors only: no tracing, no replays, nothing about the calendar's contents.
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
  capture = (e, extra) => Sentry.captureException(e, extra ? { extra } : undefined);
}

// Whole phrases only ("Upload failed: …" is a real error, not a dropped connection).
const NETWORK =
  /(?:^|[^\p{L}])(?:load failed|failed to fetch|networkerror|network request failed)(?!\p{L})/iu;

/** A dropped connection (the app retries and works offline), not a bug to report. */
export function isNetworkFailure(e: unknown): boolean {
  const message =
    e instanceof Error
      ? e.message
      : typeof e === "object" && e && "message" in e
        ? String((e as { message: unknown }).message)
        : String(e);
  return NETWORK.test(message);
}

/** Reports a handled error (one the app shows instead of crashing). */
export function reportError(e: unknown): void {
  if (!capture || isNetworkFailure(e)) return;
  // Supabase errors are plain objects: an Error keeps their message as the title.
  if (!(e instanceof Error) && typeof e === "object" && e && "message" in e) {
    const o = e as { message: unknown; code?: unknown; details?: unknown; hint?: unknown };
    const err = new Error(String(o.message));
    err.name = o.code ? String(o.code) : "SupabaseError";
    // Database diagnostics travel along (Postgres names columns and tables, not values).
    const extra = Object.fromEntries(
      (["code", "details", "hint"] as const)
        .filter((k) => typeof o[k] === "string" && o[k])
        .map((k) => [k, String(o[k]).slice(0, 500)]),
    );
    capture(err, extra);
    return;
  }
  capture(e);
}
