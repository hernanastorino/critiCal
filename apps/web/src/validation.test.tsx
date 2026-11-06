import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { exportJson, parseBackup } from "./backup.js";
import {
  ActivitySettings,
  isFigure,
  Routines,
  RuleSettings,
  WeekSettings,
} from "./components/Preferences.js";
import { Settings } from "./components/Settings.js";
import { demoData } from "./demo.js";
import type { AppData } from "./model.js";
import { StoreProvider, useStore } from "./store.js";
import { validRoutine } from "./subjects.js";

afterEach(cleanup);

let latest: AppData | null = null;
function Probe() {
  latest = useStore().data;
  return null;
}

function renderWith(children: React.ReactNode, initial = demoData) {
  return render(
    <StoreProvider initial={initial} persist={false}>
      {children}
      <Probe />
    </StoreProvider>,
  );
}

/** Whatever the forms save, the app's own backup must still read it back. */
const roundTrips = () => {
  expect(parseBackup(exportJson(latest as AppData, Date.now()))).toHaveProperty("data");
};

describe("Reglas", () => {
  it("refuses what is not a plain figure and keeps the saved values", () => {
    renderWith(<RuleSettings />);
    const before = latest?.settings;
    for (const bad of ["-5abc", "1e308", "abc"]) {
      fireEvent.change(screen.getByLabelText("Avisar cuando el margen baja de (h)"), {
        target: { value: bad },
      });
      fireEvent.click(screen.getByRole("button", { name: "Guardar reglas" }));
      expect(screen.getByRole("alert").textContent).toMatch(/solo cifras/);
      expect(latest?.settings).toBe(before);
    }
    expect(isFigure("1,5")).toBe(true);
    expect(isFigure(" 2 ")).toBe(true);
  });

  it("caps huge values and shows what was saved, which a backup can still restore", () => {
    renderWith(<RuleSettings />);
    fireEvent.change(screen.getByLabelText("Máximo de materias por día"), {
      target: { value: "99" },
    });
    fireEvent.change(screen.getByLabelText("Margen antes de cada evento (min)"), {
      target: { value: "99999999999" },
    });
    fireEvent.change(screen.getByLabelText("Avisar cuando el margen baja de (h)"), {
      target: { value: "9999" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar reglas" }));
    expect(latest?.settings.maxActivitiesPerDay).toBe(10);
    expect(latest?.settings.travelMarginMinutes).toBe(240);
    expect(latest?.settings.warnSlackMinutes).toBe(168 * 60);
    expect(
      (screen.getByLabelText("Margen antes de cada evento (min)") as HTMLInputElement).value,
    ).toBe("240");
    roundTrips();
  });
});

describe("Mi semana", () => {
  it("caps a meal's length, so the backup still restores", () => {
    renderWith(<WeekSettings />);
    fireEvent.change(screen.getAllByLabelText("Dura (min)")[0] as HTMLElement, {
      target: { value: "99999" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Guardar para/ }));
    const breakfast = latest?.settings.week[1]?.meals.find((m) => m.kind === "desayuno");
    expect(breakfast ? breakfast.end - breakfast.start : 0).toBe(240);
    expect((screen.getAllByLabelText("Dura (min)")[0] as HTMLInputElement).value).toBe("240");
    roundTrips();
  });

  it("does not save a meal while asleep, nor the same time to get up and to bed", () => {
    renderWith(<WeekSettings />);
    const before = latest?.settings.week;
    fireEvent.change(screen.getByLabelText("Me levanto"), { target: { value: "23:00" } });
    fireEvent.change(screen.getByLabelText("Me acuesto"), { target: { value: "01:00" } });
    fireEvent.click(screen.getByRole("button", { name: /^Guardar para/ }));
    expect(screen.getByRole("alert").textContent).toMatch(
      /Desayuno a las 07:30 cae cuando estás dormido/,
    );
    expect(latest?.settings.week).toBe(before);
    fireEvent.change(screen.getByLabelText("Me acuesto"), { target: { value: "23:00" } });
    fireEvent.click(screen.getByRole("button", { name: /^Guardar para/ }));
    expect(screen.getByRole("alert").textContent).toMatch(/misma hora/);
  });

  it("explains the planning start with the morning as it will be saved", () => {
    renderWith(<WeekSettings />);
    fireEvent.change(screen.getByLabelText("Arreglarse, traslado (min)"), {
      target: { value: "-100" },
    });
    expect(screen.getByText(/No se planifica nada antes de/).textContent).toContain(
      latest?.settings.week[1] ? "07:30" : "",
    );
  });
});

describe("Materias", () => {
  it("does not save a minimum block longer than the session, nor a backwards window", () => {
    renderWith(<ActivitySettings />);
    const name = latest?.activities[0]?.name as string;
    fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
    const save = screen.getByRole("button", { name: `Guardar ${name}` });
    fireEvent.change(screen.getByLabelText("Sesión máxima (min)"), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText("Bloque mínimo (min)"), { target: { value: "500" } });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/bloque mínimo/);
    fireEvent.change(screen.getByLabelText("Bloque mínimo (min)"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Prefiero desde"), { target: { value: "20:00" } });
    fireEvent.change(screen.getByLabelText("hasta"), { target: { value: "08:00" } });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/antes de «hasta»/);
  });
});

describe("Rutinas", () => {
  it("caps a routine at what a week can hold", () => {
    expect(validRoutine(3, 60)).toBe(true);
    expect(validRoutine(14, 999)).toBe(false);
    expect(validRoutine(10, 240)).toBe(true);
    expect(validRoutine(14, 200)).toBe(false);
  });

  it("opens a routine to edit, pause or delete it, and follows a rename", () => {
    renderWith(
      <>
        <Routines />
        <ActivitySettings />
      </>,
    );
    fireEvent.change(screen.getByPlaceholderText("Gimnasio"), { target: { value: "Natación" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar rutina" }));
    fireEvent.click(screen.getByRole("button", { name: /^Natación, 3 por semana/ }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByText("Editar")).toBeTruthy();
    expect(within(sheet).getByText(/Eliminar/)).toBeTruthy();
    fireEvent.click(within(sheet).getAllByLabelText("Cerrar")[0] as HTMLElement);
    // Renamed from Materias: its silo takes the new name.
    fireEvent.click(screen.getByRole("button", { name: /^Natación.*rutina/ }));
    fireEvent.change(screen.getByLabelText("Nombre de la materia"), {
      target: { value: "Pileta" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar Pileta" }));
    expect(latest?.tasks.find((t) => t.kind === "habit" && t.title === "Pileta")).toBeTruthy();
  });
});

describe("backup and Hoy", () => {
  it("refuses a backup with a colour that is not #rrggbb or a nameless materia", () => {
    const d = demoData(Date.now());
    const withActivity = (patch: object) =>
      exportJson(
        {
          ...d,
          activities: [{ ...d.activities[0], ...patch }, ...d.activities.slice(1)],
        } as AppData,
        Date.now(),
      );
    expect(parseBackup(exportJson(d, Date.now()))).toHaveProperty("data");
    expect(parseBackup(withActivity({ color: "javascript:alert(1)" }))).toEqual({
      error: "Al respaldo le faltan datos.",
    });
    expect(parseBackup(withActivity({ color: "red;background-image:url(x)" }))).toHaveProperty(
      "error",
    );
    expect(parseBackup(withActivity({ name: "  " }))).toHaveProperty("error");
  });

  it("applies «Reacomodar hoy» once on a double tap", () => {
    renderWith(<Settings onClose={() => {}} />);
    const before = latest?.planHistory?.length ?? 0;
    const button = screen.getByRole("button", { name: "Reacomodar hoy" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect((latest?.planHistory?.length ?? 0) - before).toBeLessThanOrEqual(1);
  });
});
