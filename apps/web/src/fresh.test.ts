import { beforeEach, describe, expect, it, vi } from "vitest";
import { TOMBSTONES_MS } from "./data.js";
import { demoData } from "./demo.js";
import { loadFresh } from "./fresh.js";
import { rowsClient } from "./testingRows.js";

vi.mock("./monitoring.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./monitoring.js")>()),
  reportError: vi.fn(),
}));

const NOW = Date.parse("2026-11-25T15:00:00Z");
const base = demoData(NOW);

/** A server with one event and a clock; `failChanges` makes the changed-rows queries fail. */
function server(options: { rpcError?: unknown } = {}) {
  const tables = {
    calendar_events: [
      {
        source: "google",
        external_id: "e1",
        title: "Clase",
        start_at: new Date(NOW).toISOString(),
        end_at: new Date(NOW + 3_600_000).toISOString(),
        busy: true,
        all_day: false,
        updated_at: new Date(NOW - 1000).toISOString(),
      },
    ],
  };
  return rowsClient(tables, { serverNow: () => NOW, ...options });
}

describe("loadFresh", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks only for the changes when it has a recent mark", async () => {
    const { client, requests } = server();
    const r = await loadFresh(client, base, NOW - 60_000);
    expect(r.whole).toBe(false);
    expect(r.at).toBe(NOW);
    expect(requests.some((q) => q.table === "deleted_rows")).toBe(true);
  });

  it("loads everything when it has no mark", async () => {
    const { client, requests } = server();
    const r = await loadFresh(client, base, null);
    expect(r.whole).toBe(true);
    expect(r.at).toBe(NOW);
    expect(requests.some((q) => q.table === "deleted_rows")).toBe(false);
    expect(r.data.events.map((e) => e.id)).toEqual(["google:e1"]);
  });

  it("loads everything when the mark is older than the tombstones last", async () => {
    const { client } = server();
    const r = await loadFresh(client, base, NOW - TOMBSTONES_MS);
    expect(r.whole).toBe(true);
  });

  it("loads everything on a server without the clock function yet (migration not applied)", async () => {
    const { client } = server({ rpcError: { code: "PGRST202", message: "no function" } });
    const r = await loadFresh(client, base, NOW - 60_000);
    expect(r.whole).toBe(true);
    // No trusted clock: no mark either, so the next time is a whole load too.
    expect(r.at).toBeNull();
  });

  it("loads everything, and says so, when the changes cannot be read", async () => {
    const { client, requests } = server();
    // The changes ask for tombstones: a server that refuses that table.
    const broken = new Proxy(client as object, {
      get(target, prop) {
        if (prop !== "from") return Reflect.get(target, prop);
        const from = Reflect.get(target, "from") as (...args: unknown[]) => unknown;
        return (...args: unknown[]) => {
          if (args.at(0) === "deleted_rows") throw new Error("relation does not exist");
          return from(...args);
        };
      },
    }) as never;
    const r = await loadFresh(broken, base, NOW - 60_000);
    expect(r.whole).toBe(true);
    expect(requests.length).toBeGreaterThan(0);
    const { reportError } = await import("./monitoring.js");
    expect(reportError).toHaveBeenCalled();
  });

  it("does not hide a network failure", async () => {
    const down = Object.assign(new TypeError("Failed to fetch"), {});
    const { client } = server({ rpcError: down });
    await expect(loadFresh(client, base, NOW - 60_000)).rejects.toThrow("Failed to fetch");
  });
});
