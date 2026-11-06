import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Connected } from "./Connected.js";
import { GeminiKey } from "./components/GeminiKey.js";
import { clearLocal } from "./offline.js";
import { session, stubApi } from "./testing.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(async () => {
  localStorage.clear();
  await clearLocal();
});

function client() {
  const ok = Promise.resolve({ data: [], error: null });
  const from = () => ({
    select: () =>
      Object.assign(ok, { maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
    upsert: () => Promise.resolve({ error: null }),
    insert: () => Promise.resolve({ error: null }),
    delete: () => ({ in: () => Promise.resolve({ error: null }) }),
  });
  stubApi(vi.fn(async () => ({ data: { connected: true }, error: null })));
  return { from, auth: session } as never;
}

describe("own Gemini key", () => {
  it("says the status is unknown when it cannot be read, and tries again", async () => {
    // Before stubbing fetch: the fake client stubs it too.
    const db = client();
    const answers = [
      new Response("down", { status: 500 }),
      Response.json({ ok: true, own: true, fallback: true }),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).includes("/api/syllabus")
          ? (answers.shift() ?? Response.json({ ok: true, own: true }))
          : Response.json({ connected: true }),
      ),
    );
    render(
      <Connected client={db} session={{ user: { id: "u" } } as never}>
        <GeminiKey />
      </Connected>,
    );
    expect(await screen.findByText("No se pudo ver qué clave usás.")).toBeTruthy();
    // Unknown is not "the app's key": removing stays possible.
    expect(screen.getByText("Quitar mi clave")).toBeTruthy();
    expect(screen.queryByText(/Usás la clave de critiCal/)).toBeNull();
    fireEvent.click(screen.getByText("Volver a probar"));
    expect(await screen.findByText(/Usás tu propia clave de Gemini/)).toBeTruthy();
  });

  it("ignores an older status answer that arrives after a newer one", async () => {
    const db = client();
    const pending: ((r: Response) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        String(url).includes("/api/syllabus")
          ? new Promise<Response>((resolve) => pending.push(resolve))
          : Promise.resolve(Response.json({ connected: true })),
      ),
    );
    render(
      <Connected client={db} session={{ user: { id: "u" } } as never}>
        <GeminiKey />
      </Connected>,
    );
    await waitFor(() => expect(pending.length).toBe(1));
    await act(async () => pending[0]?.(new Response("down", { status: 500 })));
    fireEvent.click(await screen.findByText("Volver a probar"));
    fireEvent.click(screen.getByText("Volver a probar"));
    await waitFor(() => expect(pending.length).toBe(3));
    await act(async () => pending[2]?.(Response.json({ ok: true, own: true, fallback: true })));
    await act(async () => pending[1]?.(Response.json({ ok: true, own: false, fallback: true })));
    expect(screen.getByText(/Usás tu propia clave de Gemini/)).toBeTruthy();
  });

  it("does not let a status answer older than a saved key undo it", async () => {
    const db = client();
    const pending: ((r: Response) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit = {}) => {
        if (!String(url).includes("/api/syllabus"))
          return Promise.resolve(Response.json({ connected: true }));
        const { action } = JSON.parse(String(init.body ?? "{}")) as { action?: string };
        if (action === "set_key")
          return Promise.resolve(Response.json({ ok: true, own: true, fallback: true }));
        return new Promise<Response>((resolve) => pending.push(resolve));
      }),
    );
    render(
      <Connected client={db} session={{ user: { id: "u" } } as never}>
        <GeminiKey />
      </Connected>,
    );
    await waitFor(() => expect(pending.length).toBe(1));
    fireEvent.change(screen.getByLabelText("Clave de Gemini"), {
      target: { value: "fake-gemini-key-that-works-0001" },
    });
    fireEvent.click(screen.getByText("Guardar"));
    expect(await screen.findByText(/Usás tu propia clave de Gemini/)).toBeTruthy();
    // The status asked before saving answers now, with the old state.
    await act(async () => pending[0]?.(Response.json({ ok: true, own: false, fallback: true })));
    expect(screen.getByText(/Usás tu propia clave de Gemini/)).toBeTruthy();
    expect(screen.getByText("Quitar mi clave")).toBeTruthy();
  });

  it("says when there is no key at all after removing one's own", async () => {
    const db = client();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if (!String(url).includes("/api/syllabus")) return Response.json({ connected: true });
        const { action } = JSON.parse(String(init.body ?? "{}")) as { action?: string };
        return action === "clear_key"
          ? Response.json({ ok: true, own: false, fallback: false })
          : new Response("down", { status: 500 });
      }),
    );
    render(
      <Connected client={db} session={{ user: { id: "u" } } as never}>
        <GeminiKey />
      </Connected>,
    );
    fireEvent.click(await screen.findByText("Quitar mi clave"));
    expect(await screen.findByText(/No hay clave de Gemini/)).toBeTruthy();
  });
});
