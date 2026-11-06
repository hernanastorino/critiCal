import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Shell } from "./App.js";
import { Connected } from "./Connected.js";
import { Settings } from "./components/Settings.js";
import { demoData } from "./demo.js";
import { clearLocal } from "./offline.js";
import { StoreProvider } from "./store.js";
import { session, stubApi } from "./testing.js";

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await clearLocal();
});

const withHome = (now: number) => {
  const d = demoData(now);
  return {
    ...d,
    places: [{ id: "casa", name: "Casa", aliases: [], address: "Av. Italia 1234", isHome: true }],
  };
};

function renderDemo(initial = demoData) {
  return render(
    <StoreProvider initial={initial} persist={false}>
      <Settings onClose={() => {}} onReset={() => {}} onSignOut={() => {}} />
    </StoreProvider>,
  );
}

describe("Ajustes as a grouped list", () => {
  it("opens each section as its own screen and comes back to its row", () => {
    renderDemo(withHome);
    expect(screen.getByRole("dialog", { name: "Ajustes" })).toBeTruthy();
    // Settings for a signed-in account are not listed in demo mode.
    for (const hidden of ["Calendarios", "Tu IA (Gemini)", "Widget de silos", "Invitaciones"]) {
      expect(screen.queryByRole("button", { name: hidden })).toBeNull();
    }
    const row = screen.getByRole("button", { name: /Lugares y traslados/ });
    fireEvent.click(row);
    const page = screen.getByRole("dialog", { name: "Lugares y traslados" });
    expect(within(page).getByRole("heading", { name: "Lugares y traslados" })).toBeTruthy();
    // Only the screen on view can be reached: the list behind it is inert.
    expect(screen.queryByRole("button", { name: "Reacomodar hoy" })).toBeNull();
    const back = document.activeElement as HTMLElement;
    expect(back.textContent).toContain("Ajustes");
    fireEvent.click(back);
    expect(screen.getByRole("button", { name: "Reacomodar hoy" })).toBeTruthy();
    expect(document.activeElement).toBe(row);
  });

  it("shows what each row is set to", () => {
    renderDemo(withHome);
    const routines = demoData(Date.now()).activities.filter((a) => a.kind === "rutina").length;
    expect(screen.getByRole("button", { name: `Rutinas, ${routines}` })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Lugares y traslados, 1" })).toBeTruthy();
  });

  it("asks for a home only when there is none", () => {
    renderDemo(withHome);
    expect(screen.queryByRole("region", { name: "Avisos" })).toBeNull();
    cleanup();
    renderDemo();
    const notices = screen.getByRole("region", { name: "Avisos" });
    expect(within(notices).getByText("Falta tu casa")).toBeTruthy();
    const add = within(notices).getByRole("button", { name: "Agregar casa" });
    fireEvent.click(add);
    expect(screen.getByRole("dialog", { name: "Lugares y traslados" })).toBeTruthy();
    // Back lands on what was tapped, not on a row further down out of view.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(document.activeElement).toBe(add);
  });

  it("keeps the account's own actions in the Cuenta group", () => {
    const onReset = vi.fn();
    const onSignOut = vi.fn();
    render(
      <StoreProvider initial={withHome} persist={false}>
        <Settings onClose={() => {}} onReset={onReset} onSignOut={onSignOut} />
      </StoreProvider>,
    );
    const cuenta = screen.getByRole("region", { name: "Cuenta" });
    fireEvent.click(within(cuenta).getByRole("button", { name: "Reiniciar demo" }));
    fireEvent.click(within(cuenta).getByRole("button", { name: "Salir" }));
    expect(onReset).toHaveBeenCalledOnce();
    expect(onSignOut).toHaveBeenCalledOnce();
    expect(within(cuenta).getByText("Política de privacidad").closest("a")?.target).toBe("_blank");
  });
});

describe("Ajustes as a modal", () => {
  it("takes the focus, keeps the screen behind out of reach, and Escape goes back then closes", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <StoreProvider initial={withHome} persist={false}>
        <div className="app">
          <button type="button">Detrás</button>
          <Settings onClose={onClose} />
        </div>
      </StoreProvider>,
    );
    expect(screen.getByText("Detrás").inert).toBe(true);
    // What mounts behind while it is open (a notification switching tabs) is covered too.
    const late = document.createElement("div");
    container.querySelector(".app")?.appendChild(late);
    await waitFor(() => expect(late.inert).toBe(true));
    expect(document.activeElement?.textContent).toBe("Ajustes");
    const dialog = screen.getByRole("dialog", { name: "Ajustes" });
    fireEvent.click(screen.getByRole("button", { name: /Reglas/ }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Ajustes" })).toBe(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    // The backdrop is for taps only: no second «Cerrar» for VoiceOver or Tab.
    expect(container.querySelector(".scrim")?.getAttribute("tabindex")).toBe("-1");
    expect(screen.getAllByRole("button", { name: "Cerrar" })).toHaveLength(1);
    expect(
      screen.getAllByRole("button", { name: "Volver a Ajustes", hidden: true }).length,
    ).toBeGreaterThan(0);
  });
});

describe("Ajustes for a signed-in account", () => {
  function client(owner: boolean) {
    const ok = Promise.resolve({ data: [], error: null });
    return {
      from: () => ({
        select: () =>
          Object.assign(ok, {
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
            order: () => ok,
          }),
        upsert: () => Promise.resolve({ error: null }),
        insert: () => Promise.resolve({ error: null }),
        delete: () => ({ in: () => Promise.resolve({ error: null }) }),
      }),
      rpc: vi.fn(async (name: string) => ({ data: name === "is_owner" ? owner : null })),
      auth: { ...session, signInWithOAuth: vi.fn(async () => ({ error: null })) },
    };
  }

  async function open(owner: boolean, google: Record<string, unknown>) {
    stubApi(async (name) => ({
      data: name === "google-sync" ? google : { connected: false, error: "not_connected" },
      error: null,
    }));
    const c = client(owner);
    render(
      <Connected client={c as never} session={{ user: { id: `s${Math.random()}` } } as never}>
        <Shell />
      </Connected>,
    );
    await waitFor(() => expect(screen.getByTestId("week")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Ajustes"));
    return c;
  }

  it("puts a revoked Google first, with the button that fixes it", async () => {
    const c = await open(true, {
      connected: false,
      error: "token_refresh_failed",
      reason: "invalid_grant",
    });
    const notices = await screen.findByRole("region", { name: "Avisos" });
    expect(within(notices).getByText("Google Calendar no se sincroniza")).toBeTruthy();
    expect(within(notices).getByText(/Google revocó el permiso/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(notices).getByRole("button", { name: "Reconectar Google" }));
    });
    expect(c.auth.signInWithOAuth).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: /Calendarios, Google: revisar/ })).toBeTruthy();
  });

  it("lists invitations only for the owner", async () => {
    await open(true, { connected: true, imported: 3 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Invitaciones" })).toBeTruthy());
    expect(screen.getByRole("button", { name: /Calendarios, Google ✓/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revocar todo y borrar la cuenta" })).toBeTruthy();
    cleanup();
    await open(false, { connected: true, imported: 3 });
    expect(screen.getByRole("button", { name: /Calendarios/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Invitaciones" })).toBeNull();
  });
});
