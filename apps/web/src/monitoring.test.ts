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

  it("reports errors without personal data once configured", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://k@o1.ingest.sentry.io/1");
    vi.resetModules();
    const m = await import("./monitoring.js");
    await m.startMonitoring();
    await m.startMonitoring();
    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ sendDefaultPii: false, tracesSampleRate: 0 }),
    );
    const e = new Error("boom");
    m.reportError(e);
    expect(sentry.captureException).toHaveBeenCalledWith(e);
    // A dropped connection is not a bug; a Supabase error object becomes an Error.
    sentry.captureException.mockClear();
    m.reportError({ code: "", message: "TypeError: Load failed (x.supabase.co)" });
    m.reportError(new TypeError("Failed to fetch"));
    expect(sentry.captureException).not.toHaveBeenCalled();
    m.reportError({ code: "42501", message: "permission denied", details: "", hint: "" });
    const sent = sentry.captureException.mock.calls[0]?.[0] as Error;
    expect(sent).toBeInstanceOf(Error);
    expect(sent.message).toBe("permission denied");
    expect(sent.name).toBe("42501");
    vi.unstubAllEnvs();
  });
});
