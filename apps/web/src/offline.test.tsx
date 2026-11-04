import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Shell } from "./App.js";
import { Connected } from "./Connected.js";
import { demoData } from "./demo.js";
import { clearLocal, isOffline, readLocal, writeLocal } from "./offline.js";
import { session, stubApi } from "./testing.js";
import { held } from "./updates.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(async () => {
  localStorage.clear();
  await clearLocal();
});

describe("device copy", () => {
  it("round-trips through IndexedDB and adopts the old localStorage cache", async () => {
    const data = demoData(Date.now());
    expect(await readLocal("a")).toBeNull();
    localStorage.setItem("critical.cache.v1.a", JSON.stringify(data));
    expect(await readLocal("a")).toEqual({ data, stored: data });
    await writeLocal("a", { data, stored: null });
    expect(localStorage.getItem("critical.cache.v1.a")).toBeNull();
    expect(await readLocal("a")).toEqual({ data, stored: null });
    await clearLocal();
    expect(await readLocal("a")).toBeNull();
  });

  it("counts a write as saved only once its transaction commits", async () => {
    const data = demoData(Date.now());
    await readLocal("e"); // opens the database first
    // Holds back the commit signal of the next transaction.
    let commit: (() => void) | undefined;
    const open = IDBDatabase.prototype.transaction;
    const spy = vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (
      this: IDBDatabase,
      ...args: Parameters<IDBDatabase["transaction"]>
    ) {
      const tx = open.apply(this, args);
      Object.defineProperty(tx, "oncomplete", {
        configurable: true,
        get: () => null,
        set: (fn: () => void) => {
          commit = fn;
        },
      });
      return tx;
    });
    let done = false;
    const write = writeLocal("e", { data, stored: null }).then(() => {
      done = true;
    });
    await vi.waitFor(() => expect(commit).toBeDefined());
    await new Promise((r) => setTimeout(r, 20));
    expect(done).toBe(false);
    spy.mockRestore();
    commit?.();
    await write;
    expect(done).toBe(true);
  });

  it("reports a write as saved even if clearing the old cache throws", async () => {
    const data = demoData(Date.now());
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(await writeLocal("f", { data, stored: null })).toBe(true);
    vi.restoreAllMocks();
    expect(await readLocal("f")).toEqual({ data, stored: null });
  });

  it("ignores broken copies and forgets the old cache on sign-out", async () => {
    localStorage.setItem("critical.cache.v1.b", "null");
    expect(await readLocal("b")).toBeNull();
    await writeLocal("c", { data: { settings: {} } as never, stored: null });
    expect(await readLocal("c")).toBeNull();
    const data = demoData(Date.now());
    localStorage.setItem("critical.cache.v1.d", JSON.stringify(data));
    await clearLocal();
    expect(localStorage.getItem("critical.cache.v1.d")).toBeNull();
  });

  it("tells a lost connection from a real failure", () => {
    expect(isOffline(new TypeError("Failed to fetch"))).toBe(true);
    expect(isOffline({ message: "TypeError: Load failed" })).toBe(true);
    expect(isOffline(new Error("permission denied for table tasks"))).toBe(false);
  });
});

describe("offline", () => {
  it("keeps changes on the device and writes them when the connection is back", async () => {
    let online = false;
    const writes: string[] = [];
    const ok = Promise.resolve({ data: [], error: null });
    const from = (table: string) => ({
      select: () =>
        Object.assign(ok, { maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
      upsert: () => {
        if (!online) return Promise.resolve({ error: { message: "TypeError: Failed to fetch" } });
        writes.push(table);
        return Promise.resolve({ error: null });
      },
      insert: () => Promise.resolve({ error: null }),
      delete: () => ({ in: () => Promise.resolve({ error: null }) }),
    });
    stubApi(async () => ({ data: { connected: true }, error: null }));
    render(
      <Connected client={{ from, auth: session } as never} session={{} as never}>
        <Shell />
      </Connected>,
    );
    await waitFor(() => expect(screen.getByTestId("week")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Ajustes"));
    await act(async () => {
      fireEvent.click(screen.getByText("Reacomodar hoy"));
    });
    await waitFor(() =>
      expect(screen.getByLabelText(/Sin conexión: los cambios se guardan/)).toBeTruthy(),
    );
    expect(writes).not.toContain("day_overrides");
    // Kept on the device, so a new version may reload without losing it.
    await waitFor(() => expect(held()).toBe(false));
    const kept = await readLocal("me");
    expect(kept?.data.overrides.length).toBe(1);
    expect(kept?.stored?.overrides.length).toBe(0);

    online = true;
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(writes).toContain("day_overrides"));
    await waitFor(async () => expect((await readLocal("me"))?.stored?.overrides.length).toBe(1));
  });
});
