import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportJson, parseBackup } from "./backup.js";
import { Backup } from "./components/Backup.js";
import { Inbox } from "./components/Inbox.js";
import { TaskEditor } from "./components/TaskEditor.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { clearDrafts } from "./drafts.js";
import { zonedInstant } from "./engine.js";
import { optionPromise } from "./friendly.js";
import type { AppData, AppTask } from "./model.js";
import { reducer, StoreProvider } from "./store.js";
import { withBreaksOnTop } from "./testing.js";

const NOW = zonedInstant(TIMEZONE, "2026-11-18", 12 * 60);

const inside = (ui: React.ReactNode, initial: (now: number) => AppData = demoData) =>
  render(
    <ToastProvider>
      <StoreProvider initial={initial} persist={false} fixedNow={NOW}>
        {ui}
      </StoreProvider>
    </ToastProvider>,
  );
const set = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const alerts = () => screen.queryAllByRole("alert").map((a) => a.textContent ?? "");

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  clearDrafts();
});

/** The demo with one change to its first silo with parts, as a backup file. */
function backupWith(change: (t: AppTask) => AppTask): string {
  const d = structuredClone(demoData(NOW));
  const i = d.tasks.findIndex((t) => t.units.length > 1);
  d.tasks[i] = change(d.tasks[i] as AppTask);
  return exportJson(d, NOW);
}
const refused = (text: string) => {
  const out = parseBackup(text);
  return "error" in out;
};

describe("4. parseBackup: partes, mínimo y fecha", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: NOW }));
  afterEach(() => vi.useRealTimers());

  it("accepts what the editor makes", () => {
    expect(refused(backupWith((t) => t))).toBe(false);
  });

  it("refuses a part of 0 or of more than the silo limit", () => {
    const part = (m: number) =>
      backupWith((t) => ({
        ...t,
        units: [{ ...(t.units[0] as AppTask["units"][0]), estimateMinutes: m }],
      }));
    expect(refused(part(0))).toBe(true);
    expect(refused(part(-5))).toBe(true);
    expect(refused(part(60_001))).toBe(true);
    // A silo of 30 h in one topic is a part of 1800 min: the editor and the log make it.
    expect(refused(part(1800))).toBe(false);
    expect(refused(part(60_000))).toBe(false);
  });

  it("refuses two parts with the same id in one silo", () => {
    expect(
      refused(backupWith((t) => ({ ...t, units: [t.units[0], t.units[0]] as AppTask["units"] }))),
    ).toBe(true);
  });

  it("accepts a minimum above the estimate of a delivery (it is cut to it)", () => {
    expect(refused(backupWith((t) => ({ ...t, estimateMinutes: 100, minMinutes: 200 })))).toBe(
      false,
    );
  });

  it("refuses a deadline outside 2000 to five years ahead", () => {
    const at = (y: number, m = 5) => Date.UTC(y, m, 1, 12);
    expect(refused(backupWith((t) => ({ ...t, deadline: at(1999) })))).toBe(true);
    expect(refused(backupWith((t) => ({ ...t, deadline: at(2032) })))).toBe(true);
    expect(refused(backupWith((t) => ({ ...t, deadline: at(2031) })))).toBe(false);
    expect(refused(backupWith((t) => ({ ...t, deadline: at(2000) })))).toBe(false);
  });
});

describe("6. Importar: el error se anuncia", () => {
  it("has role=alert", async () => {
    inside(<Backup />);
    const input = screen.getByLabelText("Archivo de respaldo");
    const file = new File(["no es json"], "x.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => "no es json" });
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByText("El archivo no es JSON.");
    expect(alerts()).toEqual(["El archivo no es JSON."]);
  });
});

describe("7. La opción de tiempo libre dice lo que hace", () => {
  const free = (feasible: boolean) => ({
    kind: "use-free-time",
    result: { feasible, status: [] },
  });
  it("does not promise the minimums for good", () => {
    const text = optionPromise(free(true), false, "otro");
    expect(text).toMatch(/tiempo libre hasta el fin de esta semana/);
    expect(optionPromise(free(false), false, "otro")).toBe("otro");
    expect(optionPromise({ ...free(true), kind: "cut" }, false, "otro")).toBe(
      "Con esto llegás a todos los mínimos.",
    );
  });
});

describe("5. Bandeja: deshacer una opción avisa qué se deshizo", () => {
  it("says «Deshecho: …»", { timeout: 30_000 }, () => {
    const d0 = reducer(withBreaksOnTop(demoData(NOW)), { type: "refresh", now: NOW });
    const d = reducer(d0, {
      type: "saveRoutine",
      name: "Leer",
      sessionsPerWeek: 14,
      sessionMinutes: 60,
      now: NOW,
    });
    inside(<Inbox />, () => d);
    const choose = screen.getAllByRole("button", { name: /^Elegir: / })[0] as HTMLElement;
    const label = (choose.getAttribute("aria-label") as string).replace("Elegir: ", "");
    fireEvent.click(choose);
    fireEvent.click(screen.getByRole("button", { name: `Deshacer: ${label}` }));
    expect(screen.getByText(`Deshecho: ${label}`)).toBeTruthy();
  });
});

describe("10. Formulario de entrega", () => {
  it("0 hours estimated is said in the field", () => {
    inside(<TaskEditor onClose={() => {}} />);
    set("Nombre", "Entrega");
    set("Horas estimadas", "0");
    set("Mínimo (horas)", "0");
    expect(screen.getByLabelText("Horas estimadas").getAttribute("aria-invalid")).toBe("true");
    expect(alerts().join(" ")).toMatch(/no pueden ser 0/);
  });

  it("a part with bad minutes leaves the focus on its field", () => {
    inside(<TaskEditor onClose={() => {}} />);
    const field = screen.getByLabelText("Nueva parte: nombre y minutos entre paréntesis");
    set("Nueva parte: nombre y minutos entre paréntesis", "Práctico (70000)");
    const add = screen.getByRole("button", { name: "Agregar" });
    add.focus();
    fireEvent.click(add);
    expect(alerts().join(" ")).not.toBe("");
    expect(document.activeElement).toBe(field);
  });
});
