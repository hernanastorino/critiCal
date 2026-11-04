import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Shell } from "./App.js";
import { Connected } from "./Connected.js";
import { clearLocal, readLocal } from "./offline.js";
import { session, stubApi } from "./testing.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(async () => {
  localStorage.clear();
  await clearLocal();
});

/** A database with a home and one upcoming event at an address no place knows. */
function client(location = "Instituto Anglo") {
  const soon = Date.now() + 2 * 3_600_000;
  const rows: Record<string, unknown[]> = {
    places: [{ id: "casa", name: "Casa", aliases: [], is_home: true, lat: -34.8, lon: -56.2 }],
    calendar_events: [
      {
        source: "icloud",
        external_id: "e1",
        title: "Inglés",
        start_at: new Date(soon).toISOString(),
        end_at: new Date(soon + 3_600_000).toISOString(),
        location,
        busy: true,
        all_day: false,
      },
    ],
  };
  const from = (table: string) => {
    const ok = Promise.resolve({ data: rows[table] ?? [], error: null });
    return {
      select: () =>
        Object.assign(ok, { maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
      upsert: () => Promise.resolve({ error: null }),
      insert: () => Promise.resolve({ error: null }),
      delete: () => ({ in: () => Promise.resolve({ error: null }) }),
    };
  };
  return { from, auth: session } as never;
}

it("times an event's address in the background and keeps it off the places", async () => {
  const asked: unknown[] = [];
  stubApi(async (name, { body }) => {
    if (name === "travel") {
      asked.push(body.spots);
      return {
        data: {
          ok: true,
          spots: (body.spots as string[]).map((text) => ({ text, minutes: 12 })),
        },
        error: null,
      };
    }
    return { data: { connected: true }, error: null };
  });
  render(
    <Connected client={client()} session={{} as never}>
      <Shell />
    </Connected>,
  );
  await waitFor(() => expect(screen.getByTestId("week")).toBeTruthy());
  await waitFor(() => expect(asked).toEqual([["Instituto Anglo"]]));
  await waitFor(async () =>
    expect((await readLocal("me"))?.data.spots).toEqual([
      { key: "instituto anglo", text: "Instituto Anglo", minutes: 12 },
    ]),
  );
  expect((await readLocal("me"))?.data.places?.map((p) => p.name)).toEqual(["Casa"]);
  // Answered: not asked again.
  expect(asked).toHaveLength(1);
});

it("leaves an address for later when the lookup fails for a while", async () => {
  let calls = 0;
  stubApi(async (name) => {
    if (name === "travel") {
      calls++;
      return { data: { ok: false, error: "travel_failed" }, error: null };
    }
    return { data: { connected: true }, error: null };
  });
  render(
    <Connected client={client()} session={{} as never}>
      <Shell />
    </Connected>,
  );
  await waitFor(() => expect(calls).toBe(1));
  await new Promise((r) => setTimeout(r, 50));
  // Cooling down instead of retrying in a loop, and never marked as not found.
  expect(calls).toBe(1);
  expect((await readLocal("me"))?.data.spots ?? []).toEqual([]);
});

it("answers an address too long for the server without asking it", async () => {
  let calls = 0;
  stubApi(async (name) => {
    if (name === "travel") calls++;
    return { data: { connected: true }, error: null };
  });
  const long = "x".repeat(201);
  render(
    <Connected client={client(long)} session={{} as never}>
      <Shell />
    </Connected>,
  );
  await waitFor(async () =>
    expect((await readLocal("me"))?.data.spots).toEqual([{ key: long, text: long, failed: true }]),
  );
  expect(calls).toBe(0);
});

it("asks instead after a few failed tries", async () => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  try {
    let calls = 0;
    stubApi(async (name) => {
      if (name === "travel") {
        calls++;
        return { data: { ok: false, error: "travel_failed" }, error: null };
      }
      return { data: { connected: true }, error: null };
    });
    render(
      <Connected client={client()} session={{} as never}>
        <Shell />
      </Connected>,
    );
    await vi.waitFor(() => expect(calls).toBe(1));
    for (const tries of [2, 3]) {
      await vi.advanceTimersByTimeAsync(61_000);
      await vi.waitFor(() => expect(calls).toBe(tries));
    }
    await vi.waitFor(async () =>
      expect((await readLocal("me"))?.data.spots).toEqual([
        { key: "instituto anglo", text: "Instituto Anglo", failed: true },
      ]),
    );
    // Given up: no more tries.
    await vi.advanceTimersByTimeAsync(61_000);
    expect(calls).toBe(3);
  } finally {
    vi.useRealTimers();
  }
});

it("does not give up on an address because saves fail", async () => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  try {
    let calls = 0;
    stubApi(async (name) => {
      if (name === "travel") calls++;
      return { data: { connected: true }, error: null };
    });
    // Every write fails, so each try stops before asking the server.
    const failing = client();
    const from = (failing as unknown as { from: (t: string) => Record<string, unknown> }).from;
    const broken = {
      ...(failing as object),
      from: (t: string) => ({
        ...from(t),
        upsert: () => Promise.resolve({ error: { message: "TypeError: Failed to fetch" } }),
      }),
    } as never;
    render(
      <Connected client={broken} session={{} as never}>
        <Shell />
      </Connected>,
    );
    for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(61_000);
    expect(calls).toBe(0);
    expect((await readLocal("me"))?.data.spots ?? []).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});
