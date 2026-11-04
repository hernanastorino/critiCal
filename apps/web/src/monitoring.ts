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

/** Reports a handled error (one the app shows instead of crashing). */
export function reportError(e: unknown): void {
  capture?.(e);
}
