// Error reporting to Sentry, only when a DSN is configured. The SDK is loaded lazily so
// it costs nothing otherwise.

type Capture = (e: unknown) => void;
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
  capture = (e) => Sentry.captureException(e);
}

const NETWORK = /load failed|failed to fetch|networkerror|network request failed/i;

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
    const err = new Error(String((e as { message: unknown }).message));
    err.name =
      "code" in e && (e as { code: unknown }).code
        ? String((e as { code: unknown }).code)
        : "SupabaseError";
    capture(err);
    return;
  }
  capture(e);
}
