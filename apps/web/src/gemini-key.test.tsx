import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
});
