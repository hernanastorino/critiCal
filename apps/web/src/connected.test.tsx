import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Shell } from "./App";
import { Connected } from "./Connected";

afterEach(cleanup);

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

describe("Connected", () => {
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
