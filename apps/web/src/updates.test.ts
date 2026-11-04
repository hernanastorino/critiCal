import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { busy, RETRY_MS, SETTLE_MS, saving, watchUpdates } from "./updates.js";

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
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
  } as unknown as Window;
  const reload = vi.fn();
  const show = (v: DocumentVisibilityState) => {
    visibility = v;
    document.dispatchEvent(new Event("visibilitychange"));
  };
  const takeOver = () => sw.dispatchEvent(new Event("controllerchange"));
  return { win, reload, update, show, takeOver };
}

const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe("updates", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("reloads once a new version takes over an already controlled page", async () => {
    const { win, reload, takeOver } = fakeWindow(true);
    watchUpdates(win, reload);
    takeOver();
    await wait(SETTLE_MS - 1);
    expect(reload).not.toHaveBeenCalled();
    await wait(1);
    expect(reload).toHaveBeenCalledTimes(1);
    // The retry stops once it reloaded.
    await wait(RETRY_MS * 3);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload on the very first install", async () => {
    const { win, reload, takeOver } = fakeWindow(false);
    watchUpdates(win, reload);
    takeOver();
    await wait(SETTLE_MS);
    expect(reload).not.toHaveBeenCalled();
    // A later deploy in the same session does.
    takeOver();
    await wait(SETTLE_MS);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("never reloads over a draft, not even when the app is left", async () => {
    const { win, reload, show, takeOver } = fakeWindow(true);
    watchUpdates(win, reload);
    document.body.innerHTML = '<div role="dialog"></div>';
    takeOver();
    await wait(SETTLE_MS);
    show("hidden");
    await wait(RETRY_MS * 2);
    expect(reload).not.toHaveBeenCalled();
    // Once the sheet is closed, the next check reloads.
    show("visible");
    document.body.innerHTML = "";
    await wait(RETRY_MS);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("keeps the settle wait when the app is left right away", async () => {
    const { win, reload, show, takeOver } = fakeWindow(true);
    watchUpdates(win, reload);
    takeOver();
    show("hidden");
    await wait(0);
    expect(reload).not.toHaveBeenCalled();
    await wait(SETTLE_MS);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("waits for saves still in flight", async () => {
    const { win, reload, takeOver } = fakeWindow(true);
    watchUpdates(win, reload);
    let land = () => {};
    void saving(new Promise<void>((r) => (land = r)));
    takeOver();
    await wait(SETTLE_MS + RETRY_MS * 2);
    expect(reload).not.toHaveBeenCalled();
    land();
    await wait(0);
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
