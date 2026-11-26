import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Shell } from "./App.js";
import { Connected } from "./Connected.js";
import { loadData } from "./data.js";
import { clearLocal, readLocal, writeLocal } from "./offline.js";
import { rowsClient } from "./testingRows.js";

const DAY = 86_400_000;
const UID = "u1";

afterEach(cleanup);
beforeEach(async () => {
  localStorage.clear();
  await clearLocal();
});

const event = (i: number, updated: number, title = `Evento ${i}`) => {
  const start = Date.now() - 300 * DAY + i * 9 * 3_600_000;
  return {
    source: "google",
    external_id: `e${i}`,
    calendar_id: "c",
    title,
    start_at: new Date(start).toISOString(),
    end_at: new Date(start + 3_600_000).toISOString(),
    busy: true,
    all_day: false,
    updated_at: new Date(updated).toISOString(),
  };
};

const account = () => Array.from({ length: 1300 }, (_, i) => event(i, Date.now() - 30 * DAY));
const mount = (client: never) =>
  render(
    <Connected client={client} session={{ user: { id: UID } } as never}>
      <Shell />
    </Connected>,
  );

describe("a big account that syncs again", () => {
  it("opens from its copy and asks the server only for what changed since the last sync", async () => {
    const tables = { calendar_events: account(), deleted_rows: [] as Record<string, unknown>[] };
    const copy = await loadData(rowsClient(tables).client);
    const syncedAt = Date.now() - 10 * 60_000;
    await writeLocal(UID, { data: copy, stored: copy, syncedAt });
    // Since then: one event is new, one was edited, one was deleted.
    tables.calendar_events.push(event(5000, Date.now() - 1000, "Reunión nueva"));
    tables.calendar_events[7] = event(7, Date.now() - 1000, "Evento 7 cambiado");
    const gone = tables.calendar_events.splice(5, 1).at(0);
    if (!gone) throw new Error("the account has events");
    tables.deleted_rows.push({
      user_id: UID,
      table_name: "calendar_events",
      row_key: `google:${gone.external_id}`,
      deleted_at: new Date().toISOString(),
    });

    const { client, requests, writes } = rowsClient(tables);
    mount(client);
    await waitFor(() => expect(screen.getByTestId("week")).toBeTruthy());
    await waitFor(async () => {
      const titles = (await readLocal(UID))?.data.events.map((e) => e.title) ?? [];
      expect(titles).toContain("Reunión nueva");
      expect(titles).toContain("Evento 7 cambiado");
      expect(titles).not.toContain("Evento 5");
    });
    const events = requests.filter((r) => r.table === "calendar_events");
    // Everything it asked of the big table was about what changed: a few rows, one page.
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((r) => r.filters["gt:updated_at"] && r.from === 0)).toBe(true);
    expect(events.reduce((n, r) => n + r.rows, 0)).toBe(2);
    expect(writes.filter((w) => w.op === "delete")).toEqual([]);
    // The mark moved on to the server's clock now.
    expect((await readLocal(UID))?.syncedAt ?? 0).toBeGreaterThan(syncedAt);
  }, 60_000);

  it("keeps bringing the history in while a sync brings only the changes", async () => {
    const tables = { calendar_events: account(), deleted_rows: [] as Record<string, unknown>[] };
    let release: () => void = vi.fn();
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let open = false;
    const { client, requests } = rowsClient(tables, {
      gate: (r) => {
        const [to, since] = [r.filters["lt:start_at"], r.filters["gt:end_at"]];
        const narrow = to && since && Date.parse(to) - Date.parse(since) < 10 * DAY;
        return narrow && !open ? held : undefined;
      },
    });
    mount(client);
    await waitFor(() => expect(screen.getByTestId("week")).toBeTruthy());
    await waitFor(() => expect(screen.getByLabelText("Cargando el historial")).toBeTruthy());

    // A sync while the weeks are still on their way (the app comes back to the foreground).
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(requests.some((r) => r.table === "deleted_rows")).toBe(true));
    // The sync took only changes, and the queue was not cancelled by it.
    expect(
      requests
        .filter((r) => r.table === "calendar_events" && !r.filters["lt:start_at"])
        .every((r) => r.filters["gt:updated_at"] || r.from === 0),
    ).toBe(true);
    expect(screen.getByLabelText("Cargando el historial")).toBeTruthy();

    open = true;
    release();
    await waitFor(() => expect(screen.queryByLabelText("Cargando el historial")).toBeNull(), {
      timeout: 45_000,
    });
    await waitFor(async () => expect((await readLocal(UID))?.data.events.length).toBe(1300));
  }, 90_000);
});
