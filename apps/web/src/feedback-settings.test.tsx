import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Shell } from "./App.js";
import { Connected } from "./Connected.js";
import { clearLocal } from "./offline.js";
import { session, stubApi } from "./testing.js";

const push = vi.hoisted(() => ({ enable: vi.fn() }));
vi.mock("./push.js", async (original) => ({
  ...(await original<typeof import("./push.js")>()),
  pushState: async () => "off",
  enablePush: push.enable,
}));

beforeEach(async () => {
  localStorage.clear();
  await clearLocal();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

interface Options {
  owner?: boolean;
  invites?: { fail?: boolean };
  places?: boolean;
}

function client({ owner, invites, places }: Options = {}) {
  const rows: Record<string, unknown[]> = {
    places: places
      ? [
          { id: "casa", name: "Casa", aliases: [], is_home: true, lat: -34.8, lon: -56.2 },
          { id: "gym", name: "Gym", aliases: [], is_home: false, lat: -34.9, lon: -56.1 },
        ]
      : [],
    invites: [{ email: "amiga@gmail.com" }],
  };
  const from = (table: string) => ({
    select: () =>
      Object.assign(Promise.resolve({ data: rows[table] ?? [], error: null }), {
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        order: () => Promise.resolve({ data: rows[table] ?? [], error: null }),
      }),
    upsert: () =>
      Promise.resolve({
        error: table === "invites" && invites?.fail ? new Error("Failed to fetch") : null,
      }),
    insert: () => Promise.resolve({ error: null }),
    delete: () => ({ in: () => Promise.resolve({ error: null }) }),
  });
  return { from, auth: session, rpc: async () => ({ data: !!owner, error: null }) } as never;
}

async function open(options: Options, api: (name: string) => unknown) {
  stubApi(async (name) => ({ data: api(name), error: null }));
  render(
    <Connected client={client(options)} session={{ user: { id: `t${Math.random()}` } } as never}>
      <Shell />
    </Connected>,
  );
  await waitFor(() => expect(screen.getByTestId("week")).toBeTruthy());
  fireEvent.click(screen.getByLabelText("Ajustes"));
}

describe("travel times", () => {
  it("says the map service failed and tries again from the button", async () => {
    let calls = 0;
    await open({ places: true }, (name) => {
      if (name !== "travel") return { connected: true };
      calls++;
      return { ok: false, error: "travel_failed" };
    });
    await act(async () => fireEvent.click(await screen.findByText("Calcular con las direcciones")));
    const note = await screen.findByText(/servicio de mapas no respondió/);
    expect(note.textContent).not.toMatch(/más tarde/);
    await act(async () => fireEvent.click(screen.getByText("Probar de nuevo")));
    expect(calls).toBe(2);
  });
});

describe("notifications", () => {
  it("names what failed and retries", async () => {
    push.enable.mockRejectedValueOnce(new Error("Failed to fetch")).mockResolvedValue("on");
    await open({}, () => ({ connected: true }));
    const button = (await screen.findByText("Activar en este dispositivo")) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    await act(async () => fireEvent.click(button));
    expect(await screen.findByText("Sin conexión: no se pudo activar los avisos.")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByText("Probar de nuevo")));
    expect(push.enable).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByText(/no se pudo activar/)).toBeNull());
  });
});

describe("invitations", () => {
  it("says the invitation was not saved and offers to try again", async () => {
    await open({ owner: true, invites: { fail: true } }, () => ({ connected: true }));
    fireEvent.change(await screen.findByLabelText("Email a invitar"), {
      target: { value: "otra@gmail.com" },
    });
    await act(async () => fireEvent.click(screen.getByText("Invitar")));
    expect(await screen.findByText("Sin conexión: no se pudo invitar.")).toBeTruthy();
    expect(screen.getByText("Probar de nuevo")).toBeTruthy();
  });
});
