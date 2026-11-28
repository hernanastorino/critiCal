import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { exportJson, parseBackup } from "./backup.js";
import { Backup, backupDay, importedText } from "./components/Backup.js";
import { Notifications } from "./components/Notifications.js";
import { defaultDeadline } from "./components/TaskEditor.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { localParts, zonedInstant } from "./engine.js";
import type { AppData, AppTask } from "./model.js";
import { reducer, StoreProvider } from "./store.js";
import { pickMateria } from "./testing.js";

// A fixed path inside the repo, not user input.
// eslint-disable-next-line security/detect-non-literal-fs-filename
const css = readFileSync(join(import.meta.dirname, "styles.css"), "utf8");

const tz = TIMEZONE;
// Fixed dates, and the real one: a test that only passes on its day is no test.
const INSTANTS = [
  zonedInstant(tz, "2026-11-23", 7 * 60),
  zonedInstant(tz, "2026-11-28", 12 * 60),
  zonedInstant(tz, "2026-12-29", 22 * 60),
  Date.now(),
];

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const found = css
    .split("}")
    .map((block) => block.split("{"))
    .find(([head]) => head?.trim().split("\n").at(-1)?.trim() === selector);
  return found?.[1] ?? "";
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("1. la fecha límite de una entrega nueva", () => {
  it("sale a las 23:59 del día tres días después, no a la hora de ahora", () => {
    for (const now of INSTANTS) {
      const due = defaultDeadline(tz, now);
      const [today, dueDay] = [localParts(tz, now), localParts(tz, due)];
      expect(dueDay.minuteOfDay, `${now}`).toBe(23 * 60 + 59);
      const days =
        (Date.parse(`${dueDay.date}T00:00Z`) - Date.parse(`${today.date}T00:00Z`)) / 864e5;
      expect(days).toBe(3);
    }
  });

  it("el formulario Nueva la muestra así", () => {
    const now = INSTANTS[0] as number;
    render(<App fixedNow={now} initial={demoData} />);
    fireEvent.click(screen.getByRole("button", { name: /Silos/ }));
    fireEvent.click(screen.getByRole("button", { name: "Nueva actividad" }));
    const sheet = screen.getByRole("dialog", { name: "Nueva actividad" });
    pickMateria();
    const field = within(sheet).getByLabelText("Fecha límite") as HTMLInputElement;
    expect(field.value).toBe("2026-11-26T23:59");
  });
});

describe("2. aire entre «Repartir tiempo» y «Partes (opcional)»", () => {
  it("la nota y las partes llevan margen con los tokens de espaciado", () => {
    render(<App fixedNow={INSTANTS[0] as number} initial={demoData} />);
    fireEvent.click(screen.getByRole("button", { name: /Silos/ }));
    fireEvent.click(screen.getByRole("button", { name: "Nueva actividad" }));
    const legend = screen.getByText("Partes (opcional)");
    const fieldset = legend.closest("fieldset");
    expect(fieldset?.getAttribute("style")).toContain("margin: var(--space-3) 0 0");
  });
});

describe("3. las barras de la planificación semanal", () => {
  it("«5h30» no se parte: nowrap y, con letra grande, se achica a su columna", () => {
    expect(rule(".week-bar .week-hours")).toMatch(/white-space:\s*nowrap/);
    expect(css).toMatch(/\.week-bar \.week-hours \{\s*font-size: min\(var\(--text-xs\), 4\.5cqw\)/);
  });
});

describe("4. la dirección de un lugar", () => {
  it("se corta con «…», no a la mitad de una letra", () => {
    const block = rule(".place-addr");
    expect(block).toMatch(/text-overflow:\s*ellipsis/);
    expect(block).not.toMatch(/mask/);
  });
});

describe("5. toques de 44 pt", () => {
  it("los botones chicos, los selects y las flechas de semana miden 44", () => {
    expect(rule(".btn.small")).toMatch(/min-height:\s*44px/);
    expect(rule("select")).toMatch(/min-height:\s*44px/);
    expect(rule(".header .week-nav .icon-btn")).toMatch(/width:\s*44px/);
    // Quita lo que el ancho suma, así la cabecera no se mueve.
    expect(rule(".header .week-nav .icon-btn")).toMatch(/margin:\s*0 -8px/);
  });
});

describe("6. Respaldo", () => {
  const NOW = zonedInstant(tz, "2026-11-28", 600);

  it("dice qué hace, en una línea y sin jerga", () => {
    render(
      <ToastProvider>
        <StoreProvider initial={demoData} persist={false} fixedNow={NOW}>
          <Backup />
        </StoreProvider>
      </ToastProvider>,
    );
    expect(
      screen.getByText(
        "Guardá una copia de tus datos para recuperarlos o pasarlos a otro dispositivo.",
      ),
    ).toBeTruthy();
  });

  it("el aviso dice cuántas cosas trajo y de qué día es el respaldo", () => {
    const day = backupDay(tz, zonedInstant(tz, "2026-11-20", 600), NOW);
    expect(day).toBe("20/11");
    expect(backupDay(tz, zonedInstant(tz, "2025-03-05", 600), NOW)).toBe("5/3/2025");
    const data = {
      tasks: new Array(12).fill(0),
      events: new Array(40).fill(0),
    } as unknown as AppData;
    expect(importedText(data, day)).toBe("Importé 12 tareas y 40 eventos del 20/11");
    const one = { tasks: [0], events: [0] } as unknown as AppData;
    expect(importedText(one, null)).toBe("Importé 1 tarea y 1 evento");
  });

  it("al importar avisa con esas cifras", async () => {
    const base = demoData(NOW);
    const made = zonedInstant(tz, "2026-11-20", 600);
    const file = new File([exportJson(base, made)], "critical.json", { type: "application/json" });
    render(
      <ToastProvider>
        <StoreProvider initial={demoData} persist={false} fixedNow={NOW}>
          <Backup />
        </StoreProvider>
      </ToastProvider>,
    );
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Archivo de respaldo"), { target: { files: [file] } });
    });
    const said = `Importé ${base.tasks.length} tareas y ${base.events.length} eventos del 20/11`;
    await waitFor(() => expect(screen.getByText(said)).toBeTruthy());
  });
});

describe("7. el aviso ↶ de la cabecera", () => {
  it("recorta el nombre en lo visual y el aria-label lleva el texto completo", () => {
    const name = "Informe corto de Sistemas Distribuidos con un nombre larguísimo";
    for (const now of INSTANTS) {
      const base = demoData(now);
      const activity = base.activities.find((a) => a.kind !== "rutina");
      expect(activity).toBeTruthy();
      const renamed = {
        ...base,
        activities: base.activities.map((a) => (a.id === activity?.id ? { ...a, name } : a)),
      };
      const gone = reducer(renamed, {
        type: "deleteActivity",
        activityId: activity?.id as string,
        now,
      });
      const last = gone.planHistory?.at(-1);
      expect(last?.label).toContain("…");
      expect(last?.fullLabel).toBe(`eliminar ${name}`);
      cleanup();
      render(<App fixedNow={now} initial={() => gone} />);
      const undo = screen.getByRole("button", { name: `Deshacer: eliminar ${name}` });
      expect(undo.getAttribute("title")).toBe(`Deshacer: ${last?.label}`);
    }
  });

  it("un nombre corto no guarda texto de más", () => {
    const base = demoData(INSTANTS[0] as number);
    const id = base.activities.find((a) => a.kind !== "rutina")?.id as string;
    const gone = reducer(base, {
      type: "deleteActivity",
      activityId: id,
      now: INSTANTS[0] as number,
    });
    expect(gone.planHistory?.at(-1)?.fullLabel).toBeUndefined();
  });
});

describe("8. entrega de 0 estimado y 0 mínimo en un respaldo", () => {
  const empty = (d: AppData): AppData => {
    const t = d.tasks.find((x) => x.kind === "deliverable") as AppTask;
    return {
      ...d,
      tasks: d.tasks.map((x) =>
        x.id === t.id ? { ...x, estimateMinutes: 0, minMinutes: 0, units: [] } : x,
      ),
    };
  };

  it("se lee como hecha: no deja un silo «0h»", () => {
    for (const now of INSTANTS) {
      const data = empty(demoData(now));
      const target = data.tasks.find((x) => x.kind === "deliverable") as AppTask;
      const parsed = parseBackup(exportJson(data, now));
      if ("error" in parsed) throw new Error(parsed.error);
      const read = parsed.data.tasks.find((x) => x.id === target.id);
      expect(read?.status).toBe("done");
      // Lo demás queda como estaba.
      const others = parsed.data.tasks.filter((x) => x.id !== target.id);
      expect(others.map((x) => x.status)).toEqual(
        data.tasks.filter((x) => x.id !== target.id).map((x) => x.status),
      );
    }
  });

  it("una entrega con partes o con minutos no se toca", () => {
    const now = INSTANTS[0] as number;
    const data = demoData(now);
    const parsed = parseBackup(exportJson(data, now));
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.data.tasks.map((t) => t.status)).toEqual(data.tasks.map((t) => t.status));
  });
});

describe("9. Notificaciones en la demo", () => {
  it("las casillas salen destildadas y deshabilitadas, como dice el texto", () => {
    const on = (d: AppData): AppData => ({
      ...d,
      preferences: {
        ...d.preferences,
        notifications: { critical: true, proposals: true, sunday: true },
      },
    });
    render(
      <StoreProvider initial={(n) => on(demoData(n))} persist={false} fixedNow={INSTANTS[0]}>
        <Notifications />
      </StoreProvider>,
    );
    expect(
      screen.getByText("Entrá con Google para recibir avisos en este dispositivo."),
    ).toBeTruthy();
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.length).toBe(3);
    for (const box of boxes) {
      expect(box.checked).toBe(false);
      expect(box.disabled).toBe(true);
    }
    expect((screen.getByLabelText("Hora del recordatorio") as HTMLInputElement).disabled).toBe(
      true,
    );
  });
});

describe("10. la hoja de una rutina dice «Pausar»", () => {
  it("el botón y la hoja se llaman Pausar, no Desactivar", () => {
    const source = readFileSync(join(import.meta.dirname, "components/TaskDetail.tsx"), "utf8");
    expect(source).toContain("Pausar…");
    expect(source).toMatch(/title=\{`Pausar \$\{task\.title\}`\}/);
    expect(source).not.toContain("Desactivar");
  });
});
