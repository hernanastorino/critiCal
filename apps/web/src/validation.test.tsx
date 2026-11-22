import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { exportJson, parseBackup } from "./backup.js";
import {
  ActivitySettings,
  DetectedDefaults,
  isFigure,
  Routines,
  RuleSettings,
  WeekSettings,
} from "./components/Preferences.js";
import { Settings } from "./components/Settings.js";
import { demoData } from "./demo.js";
import type { AppData } from "./model.js";
import { reducer, StoreProvider, useStore } from "./store.js";
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

  it("refuses values out of range or not whole, beside their field, and saves nothing", () => {
    renderWith(<RuleSettings />);
    const before = latest?.settings;
    const cases = [
      ["Máximo de materias por día", "99"],
      ["Máximo de materias por día", "0,5"],
      ["Máximo de materias por día", "2.5"],
      ["Margen antes de cada evento (min)", "99999999999"],
      ["Margen antes de cada evento (min)", "15,5"],
      ["Margen antes de cada evento (min)", "1e2"],
      ["Avisar cuando el margen baja de (h)", "9999"],
    ] as const;
    for (const [label, bad] of cases) {
      const input = screen.getByLabelText(label);
      fireEvent.change(input, { target: { value: bad } });
      fireEvent.click(screen.getByRole("button", { name: "Guardar reglas" }));
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(latest?.settings).toBe(before);
      expect(screen.queryByText("Reglas guardadas")).toBeNull();
      // Back to a good value so the next case is judged on its own field.
      fireEvent.change(input, { target: { value: label.startsWith("Avisar") ? "2" : "3" } });
    }
  });

  it("saves in-range values and shows them as stored, which a backup can still restore", () => {
    renderWith(<RuleSettings />);
    fireEvent.change(screen.getByLabelText("Máximo de materias por día"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByLabelText("Margen antes de cada evento (min)"), {
      target: { value: "240" },
    });
    fireEvent.change(screen.getByLabelText("Avisar cuando el margen baja de (h)"), {
      target: { value: "168" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar reglas" }));
    expect(latest?.settings.maxActivitiesPerDay).toBe(10);
    expect(latest?.settings.travelMarginMinutes).toBe(240);
    expect(latest?.settings.warnSlackMinutes).toBe(168 * 60);
    roundTrips();
  });
});

describe("Mi semana", () => {
  it("does not save a meal longer than 4 h, so the backup still restores", () => {
    renderWith(<WeekSettings />);
    fireEvent.change(screen.getAllByLabelText("Dura (min)")[0] as HTMLElement, {
      target: { value: "99999" },
    });
    const before = latest?.settings.week[1]?.meals.find((m) => m.kind === "desayuno");
    fireEvent.click(screen.getByRole("button", { name: /^Guardar para/ }));
    expect(screen.getByRole("alert").textContent).toMatch(/desayuno.*0 y 240/);
    expect(latest?.settings.week[1]?.meals.find((m) => m.kind === "desayuno")).toEqual(before);
    roundTrips();
  });

  it("does not save a meal while asleep, nor the same time to get up and to bed", () => {
    renderWith(<WeekSettings />);
    const before = latest?.settings.week;
    fireEvent.change(screen.getByLabelText("Me levanto"), { target: { value: "23:00" } });
    fireEvent.change(screen.getByLabelText("Me acuesto"), { target: { value: "01:00" } });
    fireEvent.click(screen.getByRole("button", { name: /^Guardar para/ }));
    expect(screen.getByRole("alert").textContent).toMatch(
      /Desayuno a las 07:30 cae, o termina, cuando estás dormido/,
    );
    expect(latest?.settings.week).toBe(before);
    fireEvent.change(screen.getByLabelText("Me acuesto"), { target: { value: "23:00" } });
    fireEvent.click(screen.getByRole("button", { name: /^Guardar para/ }));
    expect(screen.getByRole("alert").textContent).toMatch(/misma hora/);
    // A long dinner that runs past bedtime does not fit either.
    fireEvent.change(screen.getByLabelText("Me levanto"), { target: { value: "07:30" } });
    fireEvent.change(screen.getByLabelText("Cena"), { target: { value: "22:45" } });
    fireEvent.change(screen.getAllByLabelText("Dura (min)")[2] as HTMLElement, {
      target: { value: "120" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Guardar para/ }));
    expect(screen.getByRole("alert").textContent).toMatch(/Cena a las 22:45 cae, o termina/);
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
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("alert").textContent).toMatch(/bloque mínimo/);
    fireEvent.change(screen.getByLabelText("Bloque mínimo (min)"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Prefiero desde"), { target: { value: "20:00" } });
    fireEvent.change(screen.getByLabelText("hasta"), { target: { value: "08:00" } });
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("alert").textContent).toMatch(/antes de «hasta»/);
  });
});

describe("habits from the editor", () => {
  it("restores a habit that is not a routine even with long sessions", () => {
    const d = demoData(Date.now());
    const act = d.activities.find((a) => a.kind !== "rutina") as AppData["activities"][number];
    const habit = {
      id: "h1",
      activityId: act.id,
      title: "Lectura larga",
      kind: "habit",
      estimateMinutes: 1200,
      minMinutes: 1200,
      sessionsPerWeek: 3,
      sessionMinutes: 400,
      priority: 2,
      status: "active",
      units: [],
    } as AppData["tasks"][number];
    expect(
      parseBackup(exportJson({ ...d, tasks: [...d.tasks, habit] }, Date.now())),
    ).toHaveProperty("data");
  });
});

describe("a routine edited in the editor", () => {
  it("keeps Rutinas' limits, so its backup still restores", () => {
    renderWith(<Routines />);
    fireEvent.click(screen.getByRole("button", { name: "Crear rutina nueva" }));
    fireEvent.change(screen.getByPlaceholderText("Gimnasio"), { target: { value: "Remo" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar rutina" }));
    fireEvent.click(screen.getByRole("button", { name: /^Remo, 3 por semana/ }));
    fireEvent.click(screen.getByText("Editar"));
    const editor = screen.getByRole("dialog", { name: "Editar" });
    const minutes = within(editor)
      .getAllByRole("textbox")
      .find((i) => (i as HTMLInputElement).value === "60");
    fireEvent.change(minutes as HTMLElement, { target: { value: "400" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Guardar" }));
    expect(within(editor).getByRole("alert").textContent).toMatch(/hasta 6 h por vez/);
    expect(latest?.tasks.find((t) => t.title === "Remo")?.sessionMinutes).toBe(60);
    roundTrips();
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
    fireEvent.click(screen.getByRole("button", { name: "Guardar Natación" }));
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

describe("second round of the attacker", () => {
  it("caps the hours for detected events and refuses non-figures", () => {
    renderWith(<DetectedDefaults />);
    const [hours] = screen.getAllByLabelText(/^Horas de/);
    fireEvent.change(hours as HTMLElement, { target: { value: "1e3" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar horas" }));
    expect(screen.getByRole("alert").textContent).toMatch(/solo cifras/);
    fireEvent.change(hours as HTMLElement, { target: { value: "2000" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar horas" }));
    expect(latest?.preferences?.importDefaults).toBeUndefined();
    fireEvent.change(hours as HTMLElement, { target: { value: "200" } });
    fireEvent.change(screen.getAllByLabelText(/^Mínimo de/)[0] as HTMLElement, {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar horas" }));
    expect(latest?.preferences?.importDefaults?.parcial?.estimate).toBe(200 * 60);
    roundTrips();
  });

  it("keeps a typed travel time to whole minutes within a day", () => {
    const d = demoData(Date.now());
    const set = (minutes: number) =>
      reducer(d, {
        type: "travelTime",
        from: "a",
        to: "b",
        minutes,
        now: Date.now(),
      }).travelTimes?.at(-1)?.minutes;
    expect(set(12.5)).toBe(13);
    expect(set(1e9)).toBe(1440);
    expect(set(-4)).toBe(0);
  });

  it("refuses a hand-edited deadline or a backwards window in a backup", () => {
    const d = demoData(Date.now());
    const bad = (patch: Partial<AppData>) =>
      parseBackup(exportJson({ ...d, ...patch } as AppData, Date.now()));
    const task = d.tasks[0] as AppData["tasks"][number];
    expect(
      bad({ tasks: [{ ...task, deadline: "mañana" as never }, ...d.tasks.slice(1)] }),
    ).toHaveProperty("error");
    expect(bad({ tasks: [{ ...task, sessionsPerWeek: 1e7 }, ...d.tasks.slice(1)] })).toHaveProperty(
      "error",
    );
    const act = d.activities[0] as AppData["activities"][number];
    expect(
      bad({
        activities: [{ ...act, preferred: { start: 900, end: 100 } }, ...d.activities.slice(1)],
      }),
    ).toHaveProperty("error");
    expect(
      bad({ activities: [{ ...act, maxSessionMinutes: 0 }, ...d.activities.slice(1)] }),
    ).toHaveProperty("error");
    expect(
      bad({
        activities: [
          { ...act, minBlockMinutes: 500, maxSessionMinutes: 60 },
          ...d.activities.slice(1),
        ],
      }),
    ).toHaveProperty("error");
    const { minMinutes: _m, ...noMin } = task;
    expect(bad({ tasks: [noMin as never, ...d.tasks.slice(1)] })).toHaveProperty("error");
  });

  it("keeps a dinner after midnight on the same day when going to bed late", () => {
    renderWith(<WeekSettings />);
    fireEvent.change(screen.getByLabelText("Me acuesto"), { target: { value: "01:30" } });
    fireEvent.change(screen.getByLabelText("Cena"), { target: { value: "00:45" } });
    fireEvent.change(screen.getByLabelText("Nada de estudio desde"), {
      target: { value: "00:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Guardar para/ }));
    const day = latest?.settings.week[1];
    expect(day?.meals.find((m) => m.kind === "cena")?.start).toBe(1440 + 45);
    expect(day?.freeFrom).toBe(1440 + 30);
    roundTrips();
  });

  it("reads a decimal comma in hours, and refuses hexadecimal", () => {
    renderWith(<RuleSettings />);
    fireEvent.change(screen.getByLabelText("Avisar cuando el margen baja de (h)"), {
      target: { value: "1,5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar reglas" }));
    expect(latest?.settings.warnSlackMinutes).toBe(90);
    expect(isFigure("0x10")).toBe(false);
  });

  it("does not add a second routine with the same name", () => {
    renderWith(<Routines />);
    fireEvent.click(screen.getByRole("button", { name: "Crear rutina nueva" }));
    const name = screen.getByPlaceholderText("Gimnasio");
    fireEvent.change(name, { target: { value: "Nadar" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar rutina" }));
    fireEvent.click(screen.getByRole("button", { name: "Crear rutina nueva" }));
    fireEvent.change(screen.getByPlaceholderText("Gimnasio"), { target: { value: " nadar " } });
    expect(
      (screen.getByRole("button", { name: "Agregar rutina" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText("Ya hay una materia o rutina con ese nombre.")).toBeTruthy();
  });
});
