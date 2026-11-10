// Error reporting to Sentry, only when a DSN is configured. The SDK is loaded lazily so
// it costs nothing otherwise.

type Capture = (e: unknown, extra?: Record<string, string>) => void;
let capture: Capture | null = null;
/**
 * Reports made before the SDK is up (a render error can come first). Kept across a
 * failed start, so a later try still sends them.
 */
let waiting: [unknown, Record<string, string> | undefined][] | null = null;
const WAIT_MAX = 20;
let loading = false;
/** A start asked for while one was loading: it runs if that one fails. */
let again = false;

export async function startMonitoring(): Promise<void> {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn || capture) return;
  if (loading) {
    again = true;
    return;
  }
  waiting ??= [];
  loading = true;
  try {
    await load(dsn);
  } catch {
    // Offline, or blocked: the reports keep waiting for the next start.
  } finally {
    loading = false;
  }
  if (again && !capture) {
    again = false;
    await startMonitoring();
  }
  again = false;
}

async function load(dsn: string) {
  const Sentry = await import("@sentry/browser");
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // Errors only: no tracing, no replays, nothing about the calendar's contents.
    // v11 collects more unless told otherwise (it replaced sendDefaultPii): everything
    // that can carry personal data or contents stays off, as it was in v10.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: {
        request: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
        response: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
      },
      httpBodies: [],
      urlQueryParams: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      graphQL: { document: false, variables: false },
    },
    tracesSampleRate: 0,
  });
  capture = (e, extra) => Sentry.captureException(e, extra ? { extra } : undefined);
  for (const [e, extra] of waiting ?? []) capture(e, extra);
  waiting = null;
}

/** To Sentry now, or once it has loaded; nowhere without a DSN. */
function send(e: unknown, extra?: Record<string, string>) {
  if (capture) capture(e, extra);
  else if (waiting && waiting.length < WAIT_MAX) waiting.push([e, extra]);
}

// Whole phrases only ("Upload failed: …" is a real error, not a dropped connection).
const NETWORK =
  /(?:^|[^\p{L}])(?:load failed|failed to fetch|networkerror|network request failed)(?!\p{L})/iu;

/** What went wrong, readable: Supabase errors are plain objects, not Errors. */
export function errorMessage(e: unknown): string {
  return e instanceof Error
    ? e.message
    : typeof e === "object" && e && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e);
}

/** A dropped connection (the app retries and works offline), not a bug to report. */
export function isNetworkFailure(e: unknown): boolean {
  return NETWORK.test(errorMessage(e));
}

/** Reports a handled error (one the app shows instead of crashing), with optional context. */
export function reportError(e: unknown, context?: Record<string, string>): void {
  if ((!capture && !waiting) || isNetworkFailure(e)) return;
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
    send(err, { ...extra, ...context });
    return;
  }
  send(e, context);
}
