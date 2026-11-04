import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Shell } from "./App.js";
import { Connected } from "./Connected.js";
import { demoData } from "./demo.js";
import { clearLocal, isOffline, readLocal, writeLocal } from "./offline.js";
import { session, stubApi } from "./testing.js";

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
