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
    vi.unstubAllEnvs();
  });
});
