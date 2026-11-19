import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Shell } from "./App.js";
import { Connected } from "./Connected.js";
import { newId } from "./model.js";
import { clearLocal } from "./offline.js";
import { useStore } from "./store.js";
import { session, stubApi } from "./testing.js";

const report = vi.fn();
vi.mock("./monitoring.js", async (original) => ({
  ...(await original<typeof import("./monitoring.js")>()),
  reportError: (e: unknown, context?: unknown) => report(e, context),
}));

beforeEach(() => {
  localStorage.clear();
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  report.mockReset();
  await clearLocal();
});

interface Write {
  table: string;
  rows: { name?: string }[];
}

/** A database that takes everything but a materia called MALA (a check violation). */
function database() {
  const writes: Write[] = [];
  const empty = Promise.resolve({ data: [], error: null });
  const from = (table: string) => ({
    select: () =>
      Object.assign(empty, {
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        order() {
          return this;
        },
      }),
    upsert: (rows: Write["rows"]) => {
      writes.push({ table, rows });
      const bad = table === "activities" && rows.some((r) => r.name === "MALA");
      const error = bad ? { code: "23514", message: "check constraint violated" } : null;
      return Promise.resolve({ error });
    },
    insert: () => Promise.resolve({ error: null }),
    delete: () => ({ in: () => Promise.resolve({ error: null }) }),
  });
  stubApi(() => Promise.resolve({ data: { connected: true }, error: null }));
  return { client: { from, auth: session } as never, writes };
}

const activity = (name: string) => ({
  id: newId(),
  name,
  color: "#FF8A00",
  academic: true,
  maxSessionMinutes: 120,
  minBlockMinutes: 60,
});

function Poke() {
  const { dispatch } = useStore();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          dispatch({ type: "saveActivity", activity: activity("MALA") });
        }}
      >
        mala
      </button>
      <button
        type="button"
        onClick={() => {
          dispatch({ type: "saveActivity", activity: activity("Buena") });
        }}
      >
        buena
      </button>
    </>
  );
}

const named = (writes: Write[], name: string) =>
  writes.filter((w) => w.table === "activities" && w.rows.some((r) => r.name === name));

describe("3b. Un error permanente de la base no traba los guardados", () => {
  it("reports it, tells the user and keeps saving what comes next", async () => {
    const { client, writes } = database();
    render(
      <Connected client={client} session={{ user: { id: `t${Math.random()}` } } as never}>
        <Poke />
      </Connected>,
    );
    fireEvent.click(await screen.findByText("mala"));
    await waitFor(() => expect(report).toHaveBeenCalled());
    expect(report.mock.calls[0]?.[0]).toMatchObject({ code: "23514" });
    expect((await screen.findByRole("alert")).textContent).toMatch(/no se pudo guardar/i);
    // The screen is not taken over, and the next save goes through.
    expect(screen.queryByText("Algo falló")).toBeNull();
    fireEvent.click(screen.getByText("buena"));
    await waitFor(() => expect(named(writes, "Buena").length).toBeGreaterThan(0));
    // The refused row is not sent again with it.
    const last = writes.filter((w) => w.table === "activities").at(-1);
    expect(last?.rows.some((r) => r.name === "MALA")).toBe(false);
  });
});

describe("2b. El programa: nombres acotados", () => {
  it("limits the subject and assessment names, in the fields and when created", async () => {
    const { client } = database();
    const year = new Date().getUTCFullYear() + 1;
    const syllabus = {
      subject: "M".repeat(120),
      units: [],
      assessments: [
        { title: "E".repeat(120), kind: "parcial", date: `${year}-09-20`, hours: 4, units: [] },
      ],
    };
    stubApi((name) =>
      Promise.resolve({
        data: name === "syllabus" ? { ok: true, syllabus } : { connected: true },
        error: null,
      }),
    );
    render(
      <Connected client={client} session={{ user: { id: `t${Math.random()}` } } as never}>
        <Shell />
      </Connected>,
    );
    await waitFor(() => expect(screen.getByTestId("week")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Ajustes"));
    const pdf = new File(["%PDF-1.4"], "programa.pdf", { type: "application/pdf" });
    await act(() => {
      fireEvent.change(screen.getByLabelText("Programa en PDF"), { target: { files: [pdf] } });
      return Promise.resolve();
    });
    const subjectField = await screen.findByLabelText("Nombre de la materia");
    expect(subjectField.getAttribute("maxlength")).toBe("60");
    expect(screen.getByLabelText("Nombre de a0").getAttribute("maxlength")).toBe("80");
    await act(() => {
      fireEvent.click(screen.getByText("Crear"));
      return Promise.resolve();
    });
    expect(screen.getByText(`${"M".repeat(60)}: 1 evaluaciones agregadas ✓`)).toBeTruthy();
  });
});
