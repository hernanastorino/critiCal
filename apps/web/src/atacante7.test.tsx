import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { exportJson, parseBackup } from "./backup.js";
import { Routines, WeekSettings } from "./components/Preferences.js";
import { Semester } from "./components/Semester.js";
import { ActivitySettings } from "./components/Subjects.js";
import { TaskDetail } from "./components/TaskDetail.js";
import { TaskEditor } from "./components/TaskEditor.js";
import { ToastProvider } from "./components/Toast.js";
import { awakeProblem } from "./dayLength.js";
import { demoData, TIMEZONE } from "./demo.js";
import { clearDrafts } from "./drafts.js";
import { zonedInstant } from "./engine.js";
import { parseClock } from "./format.js";
import type { AppData, AppTask } from "./model.js";
import { StoreProvider, useStore } from "./store.js";

const NOW = zonedInstant(TIMEZONE, "2026-11-18", 12 * 60);

let latest: AppData | undefined;
function Spy() {
  latest = useStore().data;
  return null;
}

const inside = (ui: React.ReactNode, initial: (now: number) => AppData = demoData) =>
  render(
    <ToastProvider>
      <StoreProvider initial={initial} persist={false} fixedNow={NOW}>
        <Spy />
        {ui}
      </StoreProvider>
    </ToastProvider>,
  );

const set = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const alerts = () => screen.queryAllByRole("alert").map((a) => a.textContent ?? "");

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  clearDrafts();
});

const PART = "Nueva parte: nombre y minutos entre paréntesis";

describe("1. «Nueva parte» sin tocar «Agregar»", () => {
  const open = (onClose = () => {}) => {
    inside(<TaskEditor onClose={onClose} />);
    set("Nombre", "Entrega");
  };

  it("a pending valid part is added when saving", () => {
    const onClose = vi.fn();
    open(onClose);
    set(PART, "Práctico 5 (60)");
    click("Guardar");
    const saved = latest?.tasks.find((t) => t.title === "Entrega");
    expect(saved?.units.map((u) => [u.title, u.estimateMinutes])).toEqual([["Práctico 5", 60]]);
    expect(onClose).toHaveBeenCalled();
  });

  it("a pending invalid part stops the save and says why in its field", () => {
    const onClose = vi.fn();
    open(onClose);
    set(PART, "Práctico 5 (2000)");
    click("Guardar");
    expect(latest?.tasks.some((t) => t.title === "Entrega")).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(PART).getAttribute("aria-invalid")).toBe("true");
    expect(alerts().join(" ")).toMatch(/1 a 1440/);
    expect(document.activeElement).toBe(screen.getByLabelText(PART));
  });
});

describe("2. Partes junto a la estimación", () => {
  it("shows what the parts add up to beside the estimate", () => {
    const base = demoData(NOW).tasks.find((t) => t.kind === "deliverable") as AppTask;
    const task: AppTask = {
      ...base,
      estimateMinutes: 180,
      minMinutes: 60,
      units: [
        { id: "a", title: "Tema A", estimateMinutes: 60 },
        { id: "b", title: "Tema B", estimateMinutes: 60 },
      ],
    };
    inside(<TaskEditor task={task} onClose={() => {}} />);
    expect(screen.getByText(/Partes: 2 h de 3 h estimadas/)).toBeTruthy();
  });

  it("shows nothing without parts", () => {
    inside(<TaskEditor onClose={() => {}} />);
    expect(screen.queryByText(/Partes: .* estimadas/)).toBeNull();
  });
});

describe("3. «Guardar avance»", () => {
  const task = () => demoData(NOW).tasks.find((t) => t.id === "tp-prog") as AppTask;
  const open = (onClose = () => {}) =>
    inside(<TaskDetail task={task()} onEdit={() => {}} onClose={onClose} />);
  const save = () => click("Guardar avance");

  it("nothing written says «No anotaste avance» and stays open", () => {
    const onClose = vi.fn();
    open(onClose);
    save();
    expect(alerts().join(" ")).toMatch(/No anotaste avance/);
    expect(onClose).not.toHaveBeenCalled();
    set(/^Le dediqué/, "0");
    save();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a total above the cap is an error in its field", () => {
    const onClose = vi.fn();
    open(onClose);
    set("Temas en total", "501");
    save();
    expect(screen.getByLabelText("Temas en total").getAttribute("aria-invalid")).toBe("true");
    expect(alerts().join(" ")).toMatch(/1 a 500/);
    expect(onClose).not.toHaveBeenCalled();
    expect(latest?.tasks.find((t) => t.id === "tp-prog")?.units).toHaveLength(0);
  });

  it("«Llevo hechos» above the total or negative is an error in its field", () => {
    const onClose = vi.fn();
    open(onClose);
    set("Temas en total", "6");
    for (const bad of ["7", "-1"]) {
      set("Llevo hechos", bad);
      save();
      expect(screen.getByLabelText("Llevo hechos").getAttribute("aria-invalid")).toBe("true");
      expect(onClose).not.toHaveBeenCalled();
    }
    set("Llevo hechos", "6");
    save();
    expect(onClose).toHaveBeenCalled();
  });

  it("minutes with decimals are refused, not rounded", () => {
    const onClose = vi.fn();
    open(onClose);
    set(/^Le dediqué/, "40,5");
    save();
    expect(alerts().join(" ")).toMatch(/enteros/);
    expect(screen.getByLabelText(/^Le dediqué/).getAttribute("aria-invalid")).toBe("true");
    expect(onClose).not.toHaveBeenCalled();
    set(/^Le dediqué/, "40");
    save();
    expect(onClose).toHaveBeenCalled();
  });
});

describe("4. Inicio de cuatrimestre", () => {
  it("an invisible subject name says «Poné un nombre.»", () => {
    inside(<Semester />);
    const before = latest?.activities.length;
    set("Materia", "​ ​");
    click("Agregar materia");
    expect(alerts()).toContain("Poné un nombre.");
    expect(screen.getByLabelText("Materia").getAttribute("aria-invalid")).toBe("true");
    expect(latest?.activities.length).toBe(before);
  });

  it("an empty «Empieza» says it on «Guardar fechas»", () => {
    inside(<Semester />);
    set("Empieza", "");
    set("Termina", "2027-07-01");
    click("Guardar fechas");
    expect(alerts().join(" ")).toMatch(/fecha de inicio/);
    expect(latest?.preferences?.semester).toBeUndefined();
  });

  it("an exam without a materia says «Elegí una materia.»", () => {
    inside(<Semester />);
    set("Fecha", "2027-01-10");
    click("Agregar");
    expect(alerts()).toContain("Elegí una materia.");
  });

  it("an exam with a past date says «Esa fecha ya pasó» and is not saved", () => {
    inside(<Semester />);
    const before = latest?.tasks.length;
    const subject = (latest as AppData).activities.find((a) => a.kind !== "rutina");
    set("De la materia", subject?.id as string);
    set("Fecha", "2026-11-01");
    click("Agregar");
    expect(alerts().join(" ")).toMatch(/Esa fecha ya pasó/);
    expect(latest?.tasks.length).toBe(before);
  });
});

describe("5. Mi semana", () => {
  const week = () => JSON.stringify(latest?.settings.week);
  const save = () => click(/^Guardar para/);

  it("an impossible time says «Hora inválida.» and saves nothing", () => {
    inside(<WeekSettings />);
    const before = week();
    // A time field blanks what it cannot hold (25:99): an empty one is the same thing.
    set("Me levanto", "25:99");
    save();
    expect(alerts()).toContain("Hora inválida.");
    expect(week()).toBe(before);
    expect(screen.getByLabelText("Me levanto").getAttribute("aria-invalid")).toBe("true");
  });

  it("«7» is 07:00 in Mi semana and in Hoy", () => {
    expect(parseClock("7")).toBe(420);
    expect(parseClock("07:30")).toBe(450);
    expect(parseClock("25:99")).toBeNull();
    expect(parseClock("")).toBeNull();
    expect(awakeProblem("7", "23:00")).toBeNull();
    expect(awakeProblem("25:99", "23:00")).toBe("Hora inválida.");
  });

  it("meals out of order (breakfast after dinner) are said", () => {
    inside(<WeekSettings />);
    const before = week();
    set("Desayuno", "21:00");
    set("Dura (min), desayuno", "15");
    set("Cena", "20:00");
    set("Dura (min), cena", "30");
    save();
    expect(alerts().join(" ")).toMatch(/en orden/);
    expect(week()).toBe(before);
  });

  it("«Nada de estudio desde» before waking up is said", () => {
    inside(<WeekSettings />);
    const before = week();
    set("Nada de estudio desde", "06:00");
    save();
    expect(alerts().join(" ")).toMatch(/Nada de estudio desde/);
    expect(week()).toBe(before);
  });

  it("an ordinary week still saves", () => {
    inside(<WeekSettings />);
    set("Me levanto", "08:00");
    set("Desayuno", "08:00");
    save();
    expect(latest?.settings.week[1]?.wake).toBe(480);
  });
});

describe("6. Importar JSON", () => {
  const file = (change: (d: AppData) => void) => {
    const d = structuredClone(demoData(NOW));
    change(d);
    return parseBackup(exportJson(d, NOW));
  };

  it("the demo itself imports", () => {
    expect("data" in file(() => {})).toBe(true);
  });

  it("a day too short or with an impossible time is refused as the form does", () => {
    expect(
      "error" in
        file((d) => {
          const day = d.settings.week[2];
          if (day) {
            day.wake = 8 * 60;
            day.bed = 9 * 60;
          }
        }),
    ).toBe(true);
    expect(
      "error" in
        file((d) => {
          const day = d.settings.week[2];
          if (day) day.freeFrom = 60;
        }),
    ).toBe(true);
  });

  it("long names, aliases and titles are refused", () => {
    const long = "x".repeat(301);
    expect(
      "error" in
        file((d) => {
          d.places = [{ id: "p", name: long, aliases: [] }];
        }),
    ).toBe(true);
    expect(
      "error" in
        file((d) => {
          d.places = [{ id: "p", name: "Casa", aliases: [long] }];
        }),
    ).toBe(true);
    expect(
      "error" in
        file((d) => {
          const e = d.events[0];
          if (e) e.title = long;
        }),
    ).toBe(true);
    expect(
      "data" in
        file((d) => {
          d.places = [{ id: "p", name: "Casa", aliases: ["lo de Clara"] }];
        }),
    ).toBe(true);
  });
});

describe("7. Números enteros", () => {
  it("Rutinas: times and minutes with decimals are refused", () => {
    inside(<Routines />);
    set("Rutina", "Natación");
    set("Veces/sem.", "3.5");
    expect(alerts().join(" ")).toMatch(/solo números enteros/);
    expect(screen.getByLabelText("Veces/sem.").getAttribute("aria-invalid")).toBe("true");
    click("Agregar rutina");
    expect(latest?.activities.some((a) => a.name === "Natación")).toBe(false);
    set("Veces/sem.", "3");
    set("Minutos", "60,5");
    expect(alerts().join(" ")).toMatch(/solo números enteros/);
    expect(screen.getByLabelText("Minutos").getAttribute("aria-invalid")).toBe("true");
  });

  it("Rutinas: an invisible name is not added", () => {
    inside(<Routines />);
    const before = latest?.activities.length;
    set("Rutina", "​​");
    click("Agregar rutina");
    expect(alerts()).toContain("Poné un nombre.");
    expect(latest?.activities.length).toBe(before);
  });

  it.each([
    ["Descanso (min, 0 = sin)", "5.5"],
    ["Sesión máxima (min)", "60,5"],
  ])("Materia: %s with decimals is an error", (label, value) => {
    inside(<ActivitySettings />);
    const name = (latest as AppData).activities[0]?.name as string;
    fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
    set(label, value);
    expect(alerts().join(" ")).toMatch(/solo números enteros/);
    expect(screen.getByLabelText(label).getAttribute("aria-invalid")).toBe("true");
  });
});

describe("10. Bandeja: después de «Deshacer»", () => {
  beforeEach(() => localStorage.setItem("critical.mode", "demo"));
  const tight = (now: number): AppData => {
    const d = demoData(now);
    return {
      ...d,
      tasks: d.tasks.map((t) =>
        t.id === "parcial-calc" ? { ...t, minMinutes: 3000, estimateMinutes: 3000, units: [] } : t,
      ),
    };
  };
  const T = Date.UTC(2026, 10, 2, 20);

  it.each([0, 1, 2])("option %i: focus never falls to <body>", (i) => {
    render(<App fixedNow={T} initial={tight} />);
    fireEvent.click(screen.getByRole("button", { name: /Bandeja/ }));
    fireEvent.click(screen.getAllByText("Elegir")[i] as HTMLElement);
    const undo = screen.getByRole("button", { name: /^Deshacer:/ });
    act(() => undo.focus());
    fireEvent.click(undo);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.closest(".screen")).toBeTruthy();
  });

  it("a chosen option is not offered again: it shows as taken, with its Deshacer", () => {
    render(<App fixedNow={T} initial={tight} />);
    fireEvent.click(screen.getByRole("button", { name: /Bandeja/ }));
    const labels = () =>
      screen
        .queryAllByRole("button", { name: /^Elegir:/ })
        .map((b) => b.getAttribute("aria-label"));
    fireEvent.click(screen.getAllByText("Elegir")[2] as HTMLElement);
    const taken = screen.getByRole("button", { name: /^Deshacer:/ }).getAttribute("aria-label");
    expect(labels()).not.toContain(taken?.replace("Deshacer:", "Elegir:"));
  });
});
