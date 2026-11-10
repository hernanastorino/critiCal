import { describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn() }));
vi.mock("@sentry/browser", () => sentry);

describe("monitoring", () => {
  it("does nothing without a DSN", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "");
    vi.resetModules();
    const m = await import("./monitoring.js");
    await m.startMonitoring();
    m.reportError(new Error("x"));
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it("starts with everything personal off and no tracing (v11 collects more by default)", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://k@o1.ingest.sentry.io/1");
    vi.resetModules();
    sentry.init.mockClear();
    const m = await import("./monitoring.js");
    await m.startMonitoring();
    const opts = sentry.init.mock.calls[0]?.[0];
    expect(opts.tracesSampleRate).toBe(0);
    expect(opts.dataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpBodies: [],
      databaseQueryData: false,
    });
    expect(opts.integrations).toBeUndefined();
    expect(opts.replaysSessionSampleRate).toBeUndefined();
    vi.unstubAllEnvs();
  });

  it("keeps a report made while the SDK loads and sends it once ready", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://k@o1.ingest.sentry.io/1");
    vi.resetModules();
    sentry.captureException.mockClear();
    const m = await import("./monitoring.js");
    const ready = m.startMonitoring();
    const early = new Error("render failed before Sentry");
    m.reportError(early, { componentStack: "in App" });
    m.reportError(new Error("Failed to fetch"));
    expect(sentry.captureException).not.toHaveBeenCalled();
    await ready;
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).toHaveBeenCalledWith(early, {
      extra: { componentStack: "in App" },
    });
    vi.unstubAllEnvs();
  });

  it("keeps the waiting reports when the start fails, and sends them on the next try", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://k@o1.ingest.sentry.io/1");
    vi.resetModules();
    sentry.captureException.mockClear();
    sentry.init.mockImplementationOnce(() => {
      throw new Error("blocked");
    });
    const m = await import("./monitoring.js");
    const first = m.startMonitoring();
    const early = new Error("before Sentry");
    m.reportError(early);
    await first;
    expect(sentry.captureException).not.toHaveBeenCalled();
    await m.startMonitoring();
    expect(sentry.captureException).toHaveBeenCalledWith(early, undefined);
    vi.unstubAllEnvs();
  });

  it("retries when the connection came back while a failing start was loading", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://k@o1.ingest.sentry.io/1");
    vi.resetModules();
    sentry.captureException.mockClear();
    sentry.init.mockImplementationOnce(() => {
      throw new Error("blocked");
    });
    const m = await import("./monitoring.js");
    const early = new Error("queued");
    m.reportError(early);
    const first = m.startMonitoring();
    // «online» fires while the first start is still loading.
    void m.startMonitoring();
    m.reportError(early);
    await first;
    expect(sentry.captureException).toHaveBeenCalledWith(early, undefined);
    vi.unstubAllEnvs();
  });

  it("reports errors without personal data once configured", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://k@o1.ingest.sentry.io/1");
    vi.resetModules();
    const m = await import("./monitoring.js");
    await m.startMonitoring();
    await m.startMonitoring();
    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(sentry.init).toHaveBeenCalledWith(expect.objectContaining({ tracesSampleRate: 0 }));
    const e = new Error("boom");
    m.reportError(e);
    expect(sentry.captureException).toHaveBeenCalledWith(e, undefined);
    // Context (a render error's component stack) travels as Sentry extra.
    sentry.captureException.mockClear();
    m.reportError(e, { componentStack: "in Silos" });
    expect(sentry.captureException).toHaveBeenCalledWith(e, {
      extra: { componentStack: "in Silos" },
    });
    m.reportError(new Error("Failed to fetch"), { componentStack: "in Silos" });
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    // A dropped connection is not a bug; a Supabase error object becomes an Error.
    sentry.captureException.mockClear();
    m.reportError({ code: "", message: "TypeError: Load failed (x.supabase.co)" });
    m.reportError(new TypeError("Failed to fetch"));
    expect(sentry.captureException).not.toHaveBeenCalled();
    m.reportError(new Error("Upload failed: unsupported file type"));
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    sentry.captureException.mockClear();
    m.reportError({
      code: "42501",
      message: "permission denied",
      details: "table tasks",
      hint: "",
    });
    const sent = sentry.captureException.mock.calls[0]?.[0] as Error;
    expect(sent).toBeInstanceOf(Error);
    expect(sent.message).toBe("permission denied");
    expect(sent.name).toBe("42501");
    expect(sentry.captureException.mock.calls[0]?.[1]).toEqual({
      extra: { code: "42501", details: "table tasks" },
    });
    vi.unstubAllEnvs();
  });
});
