import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { Connected } from "./Connected.js";
import { Account } from "./components/Account.js";
import { Settings } from "./components/Settings.js";
import { demoData } from "./demo.js";
import { clearLocal } from "./offline.js";
import { StoreProvider } from "./store.js";
import { session } from "./testing.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(async () => {
  localStorage.clear();
  await clearLocal();
});

function client(owner = false) {
  const ok = Promise.resolve({ data: [], error: null });
  const from = () => ({
    select: () =>
      Object.assign(ok, { maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
    upsert: () => Promise.resolve({ error: null }),
    insert: () => Promise.resolve({ error: null }),
    delete: () => ({ in: () => Promise.resolve({ error: null }) }),
  });
  const rpc = async (name: string) => ({ data: name === "is_owner" ? owner : null, error: null });
  return { from, rpc, auth: session } as never;
}

/** Stubs the server: `/api/account` answers `answer`, the syncs say connected. */
function server(answer: () => Response) {
  const sent: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      if (!String(url).includes("/api/account")) return Response.json({ connected: true });
      sent.push(JSON.parse(String(init.body)));
      return answer();
    }),
  );
  return sent;
}

const mount = (owner = false, onDeleted = vi.fn()) => {
  render(
    <Connected client={client(owner)} session={{ user: { id: "u" } } as never}>
      <Account onDeleted={onDeleted} />
    </Connected>,
  );
  return onDeleted;
};

describe("revoke everything and delete the account", () => {
  it("only deletes after typing BORRAR, with the Plan calendar by default", async () => {
    const sent = server(() => Response.json({ ok: true }));
    const onDeleted = mount();
    const button = (await screen.findByText("Borrar mi cuenta")) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const input = screen.getByLabelText(/Escribí BORRAR/);
    fireEvent.change(input, { target: { value: "borra" } });
    expect(button.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "borrar " } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(sent).toEqual([{ action: "delete", deletePlan: true }]);
  });

  it("keeps the Plan calendar when unticked, and says nothing was deleted on failure", async () => {
    const sent = server(() =>
      Response.json({ ok: false, error: "google_api_error" }, { status: 502 }),
    );
    const onDeleted = mount();
    fireEvent.click(await screen.findByLabelText(/Borrar también el calendario/));
    fireEvent.change(screen.getByLabelText(/Escribí BORRAR/), { target: { value: "BORRAR" } });
    fireEvent.click(screen.getByText("Borrar mi cuenta"));
    expect(await screen.findByText(/No se borró nada/)).toBeTruthy();
    expect(sent).toEqual([{ action: "delete", deletePlan: false }]);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("offers the owner to revoke only", async () => {
    const sent = server(() => Response.json({ ok: true }));
    mount(true);
    fireEvent.click(await screen.findByText("Revocar todo"));
    expect(await screen.findByText(/ya no tiene acceso a Google/)).toBeTruthy();
    expect(screen.queryByText("Borrar mi cuenta")).toBeNull();
    expect(sent).toEqual([{ action: "revoke", deletePlan: true }]);
  });

  it("offers the JSON export first", async () => {
    server(() => Response.json({ ok: true }));
    const created = vi.fn(() => "blob:x");
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }),
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    mount();
    fireEvent.click(await screen.findByText("Exportar JSON"));
    expect(created).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it("links the privacy policy from the login and from Settings, without it in demo mode", () => {
    render(<App />);
    expect(screen.getByText("Política de privacidad").getAttribute("href")).toBe("/privacy.html");
    cleanup();
    render(
      <StoreProvider initial={demoData}>
        <Settings onClose={() => {}} />
      </StoreProvider>,
    );
    expect(screen.getByText("Política de privacidad").closest("a")?.getAttribute("href")).toBe(
      "/privacy.html",
    );
    expect(screen.queryByText("Revocar todo y borrar la cuenta")).toBeNull();
  });
});
