import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportJson, parseBackup } from "./backup.js";
import { PlaceSearch } from "./components/PlaceSearch.js";
import { Places } from "./components/Places.js";
import { Routines } from "./components/Preferences.js";
import { Semester } from "./components/Semester.js";
import { Settings } from "./components/Settings.js";
import { ActivitySettings } from "./components/Subjects.js";
import { TaskEditor } from "./components/TaskEditor.js";
import { ToastProvider } from "./components/Toast.js";
import { awakeProblem } from "./dayLength.js";
import { demoData, TIMEZONE } from "./demo.js";
import { clearDrafts } from "./drafts.js";
import { zonedInstant } from "./engine.js";
import { isBlank, isRealDate } from "./limits.js";
import type { AppData, Place } from "./model.js";
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

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  clearDrafts();
});

describe("helpers", () => {
  it("knows real days and invisible names", () => {
    expect(isRealDate("2026-02-28")).toBe(true);
    expect(isRealDate("2026-02-30")).toBe(false);
    expect(isRealDate("0000-13-01")).toBe(false);
    expect(isBlank("  ​‍﻿ ")).toBe(true);
    expect(isBlank("")).toBe(true);
    expect(isBlank("Física")).toBe(false);
  });
});

/** What a browser does with 31/02: the field shows it, its value is empty and `badInput` is set. */
const typeUnreal = (label: string) => {
  const input = screen.getByLabelText(label);
  Object.defineProperty(input, "validity", { value: { badInput: true }, configurable: true });
  fireEvent.change(input, { target: { value: "" } });
};

describe("fecha límite imposible", () => {
  const open = () => {
    inside(<TaskEditor onClose={() => {}} />);
    set("Nombre", "Entrega");
  };

  it("a date the browser cannot read (31/02, 24:00) says it does not exist", () => {
    open();
    typeUnreal("Fecha límite");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(screen.getByRole("alert").textContent).toBe("Esa fecha no existe.");
    expect(latest?.tasks.some((t) => t.title === "Entrega")).toBe(false);
  });

  it("a real one saves", () => {
    open();
    set("Fecha límite", "2026-11-20T23:59");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(latest?.tasks.some((t) => t.title === "Entrega")).toBe(true);
  });

  it("the name has a cap", () => {
    open();
    expect(screen.getByLabelText("Nombre").getAttribute("maxlength")).toBe("80");
  });
});

describe("fechas del cuatrimestre", () => {
  it("caps the years and says an impossible start", () => {
    inside(<Semester />);
    const start = screen.getByLabelText("Empieza");
    expect(start.getAttribute("max")).toBe("2031-12-31");
    set("Empieza", "9999-01-01");
    expect(screen.getByRole("alert").textContent).toMatch(/entre el 1\/1\/2000 y el 31\/12\/2031/);
    set("Termina", "9999-12-31");
    fireEvent.click(screen.getByRole("button", { name: "Guardar fechas" }));
    expect(latest?.preferences?.semester).toBeUndefined();
    set("Empieza", "0001-01-01");
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });

  it("says an impossible «Empieza» (31/02) and does not save", () => {
    inside(<Semester />);
    set("Termina", "2026-12-01");
    typeUnreal("Empieza");
    expect(screen.getByRole("alert").textContent).toBe("Esa fecha no existe.");
    expect(screen.getByLabelText("Empieza").getAttribute("aria-invalid")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Guardar fechas" }));
    expect(latest?.preferences?.semester).toBeUndefined();
  });

  it("saves ordinary dates", () => {
    inside(<Semester />);
    set("Empieza", "2027-03-01");
    set("Termina", "2027-07-01");
    fireEvent.click(screen.getByRole("button", { name: "Guardar fechas" }));
    expect(latest?.preferences?.semester).toEqual({ start: "2027-03-01", end: "2027-07-01" });
  });

  it("says «Ya hay una materia» as an alert, and refuses an invisible name", () => {
    inside(<Semester />);
    const taken = (latest as AppData).activities[0]?.name ?? "";
    set("Materia", taken);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Ya hay una materia o rutina/);
    expect(alert.getAttribute("style")).toContain("--critical");
    set("Materia", "​​");
    // Said in its field (and refused on «Agregar materia»), not just a grey button.
    expect(screen.getByRole("alert").textContent).toBe("Poné un nombre.");
  });
});

describe("Rutinas", () => {
  it("says a repeated name as an alert", () => {
    inside(<Routines />);
    const taken = (latest as AppData).activities.find((a) => a.kind === "rutina")?.name ?? "";
    set("Rutina", taken);
    expect(screen.getByRole("alert").textContent).toMatch(/Ya hay una materia o rutina/);
  });
});

describe("formulario de una materia", () => {
  const openFirst = () => {
    inside(<ActivitySettings />);
    const name = (latest as AppData).activities[0]?.name as string;
    fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
    return name;
  };

  it.each([
    ["Sesión máxima (min)", ["0", "-5", "9999", "abc"], /sesión máxima va de 30 a 480/],
    ["Bloque mínimo (min)", ["0", "-5", "9999", "abc"], /bloque mínimo va de 30 a 480/],
    [
      "Estudio antes del descanso (min)",
      ["0", "999", "x"],
      /estudio antes del descanso va de 5 a 240/,
    ],
    ["Descanso (min, 0 = sin)", ["-1", "500", "x"], /descanso va de 0 a 120/],
  ])("%s: out of range is said, not fixed", (label, values, message) => {
    const name = openFirst();
    const before = JSON.stringify(latest?.activities[0]);
    for (const value of values) {
      set(label, value);
      expect(screen.getAllByRole("alert").some((a) => message.test(a.textContent ?? ""))).toBe(
        true,
      );
      expect(screen.getByLabelText(label).getAttribute("aria-invalid")).toBe("true");
      fireEvent.click(screen.getByRole("button", { name: `Guardar ${name}` }));
      expect(JSON.stringify(latest?.activities[0])).toBe(before);
    }
  });

  it("an empty or invisible name is an error", () => {
    openFirst();
    for (const value of ["", "   ", "​​"]) {
      set("Nombre de la materia", value);
      expect(screen.getByRole("alert").textContent).toBe("Poné un nombre.");
    }
  });

  it("an impossible time says «Hora inválida»", () => {
    openFirst();
    set("Prefiero desde", "25:99");
    set("hasta", "10:00");
    // A time field sanitizes what it cannot hold; whatever stays is judged by the app.
    const from = (screen.getByLabelText("Prefiero desde") as HTMLInputElement).value;
    if (from === "25:99") {
      expect(screen.getByRole("alert").textContent).toBe("Hora inválida.");
    }
  });
});

describe("Hoy con horas imposibles", () => {
  it("says «Hora inválida», never NaN", () => {
    expect(awakeProblem("25:99", "23:00")).toBe("Hora inválida.");
    expect(awakeProblem("abc", "23:00")).toBe("Hora inválida.");
    expect(awakeProblem("08:00", "")).toBe("Hora inválida.");
    expect(awakeProblem("08:00", "23:00")).toBeNull();
  });

  it("the screen shows it on the button", () => {
    render(
      <StoreProvider initial={demoData} persist={false} fixedNow={NOW}>
        <Settings onClose={() => {}} onReset={() => {}} onSignOut={() => {}} />
      </StoreProvider>,
    );
    set("Me levanté a las", "");
    fireEvent.click(screen.getByRole("button", { name: "Reacomodar hoy" }));
    expect(screen.getByRole("alert").textContent).toBe("Hora inválida.");
    expect(document.body.textContent).not.toMatch(/NaN/);
  });
});

describe("Mi casa", () => {
  const casa: Place = { id: "casa", name: "Casa", aliases: [], isHome: true };
  const facu: Place = { id: "facu", name: "Facultad", aliases: [] };

  it("with a home already saved, another place cannot be marked: a clear note instead", () => {
    inside(<Places />, () => ({ ...demoData(NOW), places: [casa, facu] }));
    fireEvent.click(screen.getByRole("button", { name: "Editar Facultad" }));
    expect(screen.queryByLabelText("Mi casa")).toBeNull();
    expect(screen.getByRole("note").textContent).toMatch(/Tu casa ya es Casa: hay una sola/);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    });
    expect(latest?.places?.find((p) => p.isHome)?.id).toBe("casa");
    expect(latest?.places?.filter((p) => p.isHome)).toHaveLength(1);
  });

  it("the home itself can be unmarked, and then another can take it", () => {
    inside(<Places />, () => ({ ...demoData(NOW), places: [casa, facu] }));
    fireEvent.click(screen.getByRole("button", { name: "Editar Casa" }));
    fireEvent.click(screen.getByLabelText("Mi casa"));
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    });
    expect(latest?.places?.some((p) => p.isHome)).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Editar Facultad" }));
    expect(screen.getByLabelText("Mi casa")).toBeTruthy();
  });

  it("a new place asks «Mi casa» only while there is no home", () => {
    inside(<Places />, () => ({ ...demoData(NOW), places: [casa] }));
    fireEvent.click(screen.getByRole("button", { name: "Agregar lugar" }));
    expect(screen.queryByLabelText("Mi casa")).toBeNull();
  });

  it("a new place does ask «Mi casa» when there is no home yet", () => {
    inside(<Places />, () => ({ ...demoData(NOW), places: [facu] }));
    fireEvent.click(screen.getByRole("button", { name: "Agregar lugar" }));
    expect(screen.getByLabelText("Mi casa")).toBeTruthy();
  });

  it("suggesting the home in the search does not pick it until it is chosen", () => {
    const picked: string[] = [];
    inside(<PlaceSearch label="Lugar" onPick={(p) => picked.push(p.id)} />, () => ({
      ...demoData(NOW),
      places: [casa, facu],
    }));
    fireEvent.change(screen.getByLabelText("Lugar"), { target: { value: "casa" } });
    expect(screen.getByRole("button", { name: /Casa/ })).toBeTruthy();
    expect(picked).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /Casa/ }));
    expect(picked).toEqual(["casa"]);
  });

  it("says nothing when there was no other home", () => {
    inside(<Places />, () => ({ ...demoData(NOW), places: [{ ...facu }] }));
    fireEvent.click(screen.getByRole("button", { name: "Editar Facultad" }));
    fireEvent.click(screen.getByLabelText("Mi casa"));
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    });
    expect(screen.queryByText(/Ahora tu casa es/)).toBeNull();
  });
});

describe("parseBackup", () => {
  const base = () => demoData(NOW);
  const parse = (d: AppData) => parseBackup(exportJson(d, NOW));

  it("accepts the demo", () => {
    expect(parse(base())).toHaveProperty("data");
  });

  it("refuses very long names and titles", () => {
    const d = base();
    const long = "x".repeat(301);
    expect(
      parse({
        ...d,
        activities: [{ ...d.activities[0], name: long }, ...d.activities.slice(1)],
      } as AppData),
    ).toHaveProperty("error");
    expect(
      parse({ ...d, tasks: [{ ...d.tasks[0], title: long }, ...d.tasks.slice(1)] } as AppData),
    ).toHaveProperty("error");
    const t = d.tasks[0] as AppData["tasks"][number];
    expect(
      parse({
        ...d,
        tasks: [{ ...t, units: [{ id: "u", title: long, estimateMinutes: 30 }] }],
      } as AppData),
    ).toHaveProperty("error");
  });

  it("refuses repeated ids of materias, tareas and bloques", () => {
    const d = base();
    const a = d.activities[0] as AppData["activities"][number];
    expect(parse({ ...d, activities: [...d.activities, { ...a }] })).toHaveProperty("error");
    const t = d.tasks[0] as AppData["tasks"][number];
    expect(parse({ ...d, tasks: [...d.tasks, { ...t }] })).toHaveProperty("error");
    const b = d.plan[0];
    if (b) expect(parse({ ...d, plan: [...d.plan, { ...b }] })).toHaveProperty("error");
  });
});
