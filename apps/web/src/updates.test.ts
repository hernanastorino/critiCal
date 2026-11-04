import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { busy, SETTLE_MS, watchUpdates } from "./updates.js";

/** A window whose service worker container and visibility the test drives. */
function fakeWindow(controlled: boolean) {
  const sw = new EventTarget() as EventTarget & {
    controller: object | null;
    getRegistration: () => Promise<{ update: () => Promise<void> }>;
  };
  const update = vi.fn(async () => undefined);
  sw.controller = controlled ? {} : null;
  sw.getRegistration = async () => ({ update });
  let visibility: DocumentVisibilityState = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  const win = {
    navigator: { serviceWorker: sw },
    document,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  } as unknown as Window;
  const reload = vi.fn();
  const show = (v: DocumentVisibilityState) => {
    visibility = v;
    document.dispatchEvent(new Event("visibilitychange"));
  };
  return { win, sw, reload, update, show };
}

describe("updates", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("reloads once a new version takes over an already controlled page", () => {
    const { win, sw, reload } = fakeWindow(true);
    watchUpdates(win, reload);
    sw.dispatchEvent(new Event("controllerchange"));
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SETTLE_MS);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload on the very first install", () => {
    const { win, sw, reload } = fakeWindow(false);
    watchUpdates(win, reload);
    sw.dispatchEvent(new Event("controllerchange"));
    vi.advanceTimersByTime(SETTLE_MS);
    expect(reload).not.toHaveBeenCalled();
    // A later deploy in the same session does.
    sw.dispatchEvent(new Event("controllerchange"));
    vi.advanceTimersByTime(SETTLE_MS);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("waits until the app is left when the user is in the middle of something", () => {
    const { win, sw, reload, show } = fakeWindow(true);
    watchUpdates(win, reload);
    document.body.innerHTML = '<div role="dialog"></div>';
    sw.dispatchEvent(new Event("controllerchange"));
    vi.advanceTimersByTime(SETTLE_MS);
    expect(reload).not.toHaveBeenCalled();
    show("hidden");
    expect(reload).toHaveBeenCalledTimes(1);
    // Nothing left to do on later visits.
    show("visible");
    show("hidden");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("checks for a new version whenever the app comes back", async () => {
    const { win, update, show } = fakeWindow(true);
    watchUpdates(win, vi.fn());
    show("visible");
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  });

  it("knows when the user is busy", () => {
    expect(busy(document)).toBe(false);
    document.body.innerHTML = '<input id="f"><div class="bubble-card"></div>';
    expect(busy(document)).toBe(true);
    document.body.innerHTML = '<input id="f">';
    (document.getElementById("f") as HTMLInputElement).focus();
    expect(busy(document)).toBe(true);
    document.body.innerHTML = '<button class="pill dragging"></button>';
    expect(busy(document)).toBe(true);
  });

  it("does nothing without service workers", () => {
    expect(() =>
      watchUpdates({ navigator: {}, document } as unknown as Window, vi.fn()),
    ).not.toThrow();
  });
});
