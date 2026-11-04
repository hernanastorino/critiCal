import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Shell } from "./App.js";
import { Connected } from "./Connected.js";
import { clearLocal } from "./offline.js";
import { session, stubApi } from "./testing.js";
import { widgetScript } from "./widget-script.js";

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await clearLocal();
});

function client() {
  const ok = Promise.resolve({ data: [], error: null });
  return {
    from: () => ({
      select: () =>
        Object.assign(ok, { maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
      upsert: () => Promise.resolve({ error: null }),
      insert: () => Promise.resolve({ error: null }),
      delete: () => ({ in: () => Promise.resolve({ error: null }) }),
    }),
    auth: session,
  } as never;
}

async function openSettings(api: (name: string, body: Record<string, unknown>) => unknown) {
  stubApi(async (name, opts) => ({ data: api(name, opts.body), error: null }));
  render(
    <Connected client={client()} session={{ user: { id: `t${Math.random()}` } } as never}>
      <Shell />
    </Connected>,
  );
  await waitFor(() => expect(screen.getByTestId("week")).toBeTruthy());
  fireEvent.click(screen.getByLabelText("Ajustes"));
}

describe("Scriptable widget", () => {
  it("embeds the token and this site in the script", () => {
    const s = widgetScript("https://critical-cal.vercel.app", "cw_x");
    expect(s).toContain('const TOKEN = "cw_x";');
    expect(s).toContain('"https://critical-cal.vercel.app/api/widget"');
    expect(s).toContain("Script.setWidget(widget);");
  });

  it("generates the script and copies it", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await openSettings((name, body) =>
      name === "widget"
        ? body.action === "create"
          ? { ok: true, token: "cw_tok" }
          : { ok: true }
        : { connected: true },
    );
    await act(async () => fireEvent.click(screen.getByText("Generar script")));
    const area = (await screen.findByLabelText("Script del widget")) as HTMLTextAreaElement;
    expect(area.value).toContain("cw_tok");
    await act(async () => fireEvent.click(screen.getByText("Copiar script")));
    expect(writeText).toHaveBeenCalledWith(area.value);
    await act(async () => fireEvent.click(screen.getByText("Desactivar")));
    expect(screen.getByText("Widget desactivado ✓")).toBeTruthy();
  });
});

describe("syllabus import", () => {
  it("previews what Gemini read and creates only what is kept", async () => {
    await openSettings((name) =>
      name === "syllabus"
        ? {
            ok: true,
            syllabus: {
              subject: "Física II",
              units: [
                { title: "Electrostática", hours: 10 },
                { title: "Circuitos", hours: 8 },
              ],
              assessments: [
                {
                  title: "Primer parcial",
                  kind: "parcial",
                  date: "2099-09-20",
                  hours: 0,
                  units: ["Electrostática", "Circuitos"],
                },
                { title: "Recuperatorio", kind: "parcial", date: null, hours: 6, units: [] },
              ],
            },
          }
        : { connected: true },
    );
    const pdf = new File(["%PDF-1.4"], "programa.pdf", { type: "application/pdf" });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Programa en PDF"), { target: { files: [pdf] } });
    });
    expect(await screen.findByDisplayValue("Física II")).toBeTruthy();
    expect(screen.getByText(/falta la fecha/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Horas de Circuitos"), { target: { value: "4" } });
    await act(async () => fireEvent.click(screen.getByText("Crear")));
    expect(screen.getByText("Física II: 1 evaluaciones agregadas ✓")).toBeTruthy();
  });

  it("explains a missing key or a big file", async () => {
    await openSettings((name) =>
      name === "syllabus" ? { ok: false, error: "server_not_configured" } : { connected: true },
    );
    const pdf = new File(["%PDF"], "p.pdf", { type: "application/pdf" });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Programa en PDF"), { target: { files: [pdf] } });
    });
    expect(await screen.findByText("Falta la clave de Gemini en el servidor.")).toBeTruthy();
    const big = new File([new Uint8Array(3_100_000)], "big.pdf", { type: "application/pdf" });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Programa en PDF"), { target: { files: [big] } });
    });
    expect(screen.getByText("El PDF es muy grande (máximo 3 MB).")).toBeTruthy();
  });
});
