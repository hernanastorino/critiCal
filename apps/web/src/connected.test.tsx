import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Shell } from "./App";
import { Connected } from "./Connected";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

function fakeClient(fail = false) {
  const writes: string[] = [];
  const ok = Promise.resolve({ data: [], error: null });
  const from = (table: string) => ({
    select: () =>
      Object.assign(fail ? Promise.resolve({ data: null, error: new Error("boom") }) : ok, {
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      }),
    upsert: () => {
      writes.push(table);
      return Promise.resolve({ error: null });
    },
    insert: () => Promise.resolve({ error: null }),
    delete: () => ({ in: () => Promise.resolve({ error: null }) }),
  });
  const invoke = vi.fn(async () => ({ data: { connected: true }, error: null }));
  return { client: { from, functions: { invoke } } as never, writes, invoke };
}

function calendarClient() {
  const writes: { table: string; rows: unknown }[] = [];
  let icloudConnected = false;
  const tables: Record<string, unknown[]> = {
    calendars: [
      { source: "icloud", external_id: "p", name: "Parciales", color: null, role: null },
      { source: "google", external_id: "w", name: "Trabajo", color: null, role: null },
    ],
    calendar_events: [
      {
        source: "icloud",
        external_id: "p|1",
        calendar_id: "p",
        title: "Parcial Física I",
        start_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        end_at: new Date(Date.now() + 3 * 86_400_000 + 3_600_000).toISOString(),
        busy: true,
        all_day: false,
      },
    ],
  };
  const from = (table: string) => ({
    select: () =>
      Object.assign(Promise.resolve({ data: tables[table] ?? [], error: null }), {
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      }),
    upsert: (rows: unknown) => {
      writes.push({ table, rows });
      return Promise.resolve({ error: null });
    },
    insert: () => Promise.resolve({ error: null }),
    delete: () => ({ in: () => Promise.resolve({ error: null }) }),
  });
  const invoke = vi.fn(async (name: string, opts?: { body?: { action?: string } }) => {
    if (name === "google-sync")
      return { data: { connected: false, error: "no_refresh_token" }, error: null };
    if (opts?.body?.action === "connect") icloudConnected = true;
    if (opts?.body?.action === "disconnect") {
      icloudConnected = false;
      return { data: { connected: false }, error: null };
    }
    return {
      data: icloudConnected
        ? { connected: true, imported: 7 }
        : { connected: false, error: "not_connected" },
      error: null,
    };
  });
  return { client: { from, functions: { invoke } } as never, writes, invoke };
}

describe("Connected", () => {
  it("shows sync status, connects iCloud, and imports deadline events", async () => {
    const { client, writes, invoke } = calendarClient();
    render(
      <Connected client={client} session={{} as never}>
        <Shell />
      </Connected>,
    );
    await waitFor(() => expect(screen.getByTestId("week")).toBeTruthy());

    // What the first refresh imported is persisted right away (activity before task).
    await waitFor(() => expect(writes.some((w) => w.table === "activities")).toBe(true));
    expect(writes.some((w) => w.table === "tasks")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /Bandeja/ }));
    expect(screen.getByText("Detectado en tu calendario")).toBeTruthy();
    expect(screen.getByText(/le planifico 10h/)).toBeTruthy();

    // Adjusting keeps the link to the event: no second card for the same parcial.
    fireEvent.click(screen.getByText("Ajustar"));
    fireEvent.click(screen.getByText("Guardar"));
    expect(screen.queryByText("Detectado en tu calendario")).toBeNull();
    expect(screen.getByText("Todo al día ✓")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Semana/ }));
    fireEvent.click(screen.getByLabelText("Ajustes"));
    expect(screen.getByTestId("google-status").textContent).toMatch(/Reconectar Google/);
    expect(screen.getByTestId("icloud-status").textContent).toBe("Sin conectar.");

    fireEvent.change(screen.getByLabelText("Tipo de Trabajo"), { target: { value: "ignore" } });
    await waitFor(() => expect(writes.some((w) => w.table === "calendars")).toBe(true));

    fireEvent.change(screen.getByLabelText("Apple ID"), { target: { value: "yo@icloud.com" } });
    fireEvent.change(screen.getByLabelText("Contraseña específica de app"), {
      target: { value: "abcd-efgh" },
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Conectar iCloud"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("icloud-status").textContent).toMatch(/7 eventos/),
    );
    expect(invoke).toHaveBeenCalledWith("icloud-sync", {
      body: { action: "connect", appleId: "yo@icloud.com", appPassword: "abcd-efgh" },
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Sincronizar ahora"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Desconectar iCloud"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("icloud-status").textContent).toBe("Sin conectar."),
    );
  });

  it("syncs, loads and saves changes", async () => {
    const { client, writes, invoke } = fakeClient();
    render(
      <Connected client={client} session={{ provider_refresh_token: "r" } as never}>
        <Shell />
      </Connected>,
    );
    expect(screen.getByText(/Sincronizando/)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("week")).toBeTruthy());
    expect(invoke).toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Ajustes"));
    await act(async () => {
      fireEvent.click(screen.getByText("Reacomodar hoy"));
    });
    await waitFor(() => expect(writes).toContain("day_overrides"));

    await act(async () => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(invoke.mock.calls.length).toBeGreaterThan(1));
  });

  it("opens instantly from the device cache and refreshes in the background", async () => {
    const first = fakeClient();
    const { unmount } = render(
      <Connected client={first.client} session={{} as never}>
        <Shell />
      </Connected>,
    );
    await waitFor(() => expect(screen.getByTestId("week")).toBeTruthy());
    unmount();
    expect(localStorage.getItem("critical.cache.v1.me")).toBeTruthy();

    const second = fakeClient();
    render(
      <Connected client={second.client} session={{} as never}>
        <Shell />
      </Connected>,
    );
    expect(screen.getByTestId("week")).toBeTruthy();
    expect(screen.getByLabelText("Sincronizando")).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText("Todo sincronizado")).toBeTruthy());
  });

  it("shows an error when loading fails", async () => {
    const { client } = fakeClient(true);
    render(
      <Connected client={client} session={{} as never}>
        <Shell />
      </Connected>,
    );
    await waitFor(() => expect(screen.getByText("Algo falló")).toBeTruthy());
  });
});
