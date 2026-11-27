import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { exportJson, parseBackup } from "./backup.js";
import { Inbox } from "./components/Inbox.js";
import { WeekSettings } from "./components/Preferences.js";
import { Semester } from "./components/Semester.js";
import { ActivitySettings } from "./components/Subjects.js";
import { TaskEditor } from "./components/TaskEditor.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { clearDrafts } from "./drafts.js";
import { zonedInstant } from "./engine.js";
import type { AppData } from "./model.js";
import { decisions, refreshPlan } from "./planning.js";
import { reducer, StoreProvider, seedHistory, useStore } from "./store.js";
import { parseUnit } from "./taskForm.js";
import { tapDone } from "./testDone.js";
import { withBreaksOnTop } from "./testing.js";

const NOW = zonedInstant(TIMEZONE, "2026-11-18", 12 * 60);

let latest: AppData | undefined;
function Spy() {
  latest = useStore().data;
  return null;
}

const inside = (ui: React.ReactNode, initial: (now: number) => AppData = demoData, at = NOW) =>
  render(
    <ToastProvider>
      <StoreProvider initial={initial} persist={false} fixedNow={at}>
        <Spy />
        {ui}
      </StoreProvider>
    </ToastProvider>,
  );

const set = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const alerts = () => screen.queryAllByRole("alert").map((a) => a.textContent ?? "");
/** A time field blanks what it cannot hold («7»): typed as text it keeps it, like an old browser. */
const typeTime = (label: string, value: string) => {
  (screen.getByLabelText(label) as HTMLInputElement).type = "text";
  set(label, value);
};

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  clearDrafts();
});

describe("1. Mi semana y el respaldo piden el mismo día", () => {
  const week = () => JSON.stringify(latest?.settings.week);
  const save = () => click(/^Guardar para/);

  it.each([
    ["07:30", "07:00", /23h30/],
    ["00:00", "23:59", /23h59/],
    ["08:00", "11:00", /3h:/],
  ])("%s a %s is refused in the day's fields", (wake, bed, said) => {
    inside(<WeekSettings />);
    const before = week();
    set("Me levanto", wake);
    set("Me acuesto", bed);
    set("Desayuno", wake);
    // Meals asleep are said first: this day has none.
    set("Dura (min), almuerzo", "0");
    set("Dura (min), cena", "0");
    set("Nada de estudio desde", bed);
    save();
    expect(alerts().join(" ")).toMatch(said);
    expect(alerts().join(" ")).toMatch(/entre 4 y 22 h despierto/);
    expect(week()).toBe(before);
    expect(screen.getByLabelText("Me levanto").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Me acuesto").getAttribute("aria-invalid")).toBe("true");
  });

  it("a backup with such a day says which day and why", () => {
    const d = structuredClone(demoData(NOW));
    d.settings.week[1] = {
      ...(d.settings.week[1] as AppData["settings"]["week"][0]),
      wake: 450,
      bed: 420,
    };
    const out = parseBackup(exportJson(d, NOW));
    expect("error" in out && out.error).toMatch(/^El lunes tiene 23h30 despierto/);
  });

  it("whatever the app saves in Mi semana imports back", () => {
    const ok: [string, string][] = [
      ["06:00", "23:00"],
      ["10:00", "02:00"],
      ["05:00", "01:00"],
      ["09:00", "13:00"],
    ];
    for (const [wake, bed] of ok) {
      inside(<WeekSettings />);
      set("Me levanto", wake);
      set("Me acuesto", bed);
      set("Desayuno", wake);
      set("Nada de estudio desde", bed < wake ? "00:30" : bed);
      set("Dura (min), almuerzo", "0");
      set("Dura (min), cena", "0");
      save();
      expect(alerts()).toEqual([]);
      const out = parseBackup(exportJson(latest as AppData, NOW));
      expect("error" in out ? out.error : null).toBeNull();
      cleanup();
      clearDrafts();
    }
  });
});

describe("3. Mi semana: minutos enteros y horas normalizadas", () => {
  it("minutes with decimals are an error in their field", () => {
    inside(<WeekSettings />);
    const before = JSON.stringify(latest?.settings.week);
    set("Arreglarse, traslado (min)", "1,5");
    click(/^Guardar para/);
    expect(alerts().join(" ")).toMatch(/solo números enteros/);
    expect(screen.getByLabelText("Arreglarse, traslado (min)").getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(JSON.stringify(latest?.settings.week)).toBe(before);
  });

  it("a duration of a meal with decimals too", () => {
    inside(<WeekSettings />);
    set("Dura (min), almuerzo", "45.5");
    click(/^Guardar para/);
    expect(alerts().join(" ")).toMatch(/solo números enteros/);
  });

  it("«7» and «7:5» are shown as 07:00 and 07:05 once saved", () => {
    inside(<WeekSettings />);
    typeTime("Me levanto", "7");
    typeTime("Desayuno", "7:5");
    set("Dura (min), desayuno", "10");
    click(/^Guardar para/);
    expect(alerts()).toEqual([]);
    expect(latest?.settings.week[1]?.wake).toBe(420);
    expect((screen.getByLabelText("Me levanto") as HTMLInputElement).value).toBe("07:00");
    expect((screen.getByLabelText("Desayuno") as HTMLInputElement).value).toBe("07:05");
  });
});

describe("4. Materia: «Prefiero desde / hasta»", () => {
  const open = () => {
    inside(<ActivitySettings />);
    const name = (latest as AppData).activities[0]?.name as string;
    fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
  };

  it("«7» is 07:00 and saves", () => {
    open();
    typeTime("Prefiero desde", "7");
    typeTime("hasta", "10");
    expect(alerts()).toEqual([]);
    expect(screen.getByLabelText("Prefiero desde").getAttribute("aria-invalid")).toBeNull();
    click(/^Guardar/);
    expect(latest?.activities[0]?.preferred).toEqual({ start: 420, end: 600 });
  });

  it("marks only the field that is not a time", () => {
    open();
    set("Prefiero desde", "08:00");
    typeTime("hasta", "25:99");
    expect(alerts().join(" ")).toMatch(/Hora inválida/);
    expect(screen.getByLabelText("hasta").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Prefiero desde").getAttribute("aria-invalid")).toBeNull();
  });
});

describe("9.ª vuelta: «Prefiero desde / hasta» a medias o hasta medianoche", () => {
  const open = () => {
    inside(<ActivitySettings />);
    const name = (latest as AppData).activities[0]?.name as string;
    fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
  };

  it("one field alone is an error in the empty one, not a silent drop", () => {
    open();
    set("hasta", "");
    set("Prefiero desde", "08:00");
    expect(alerts().join(" ")).toMatch(/Poné también hasta qué hora/);
    expect(screen.getByLabelText("hasta").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Prefiero desde").getAttribute("aria-invalid")).toBeNull();
    set("Prefiero desde", "");
    set("hasta", "10:00");
    expect(alerts().join(" ")).toMatch(/Poné también desde qué hora/);
    expect(screen.getByLabelText("Prefiero desde").getAttribute("aria-invalid")).toBe("true");
  });

  it("«hasta» may be midnight", () => {
    open();
    set("Prefiero desde", "20:00");
    typeTime("hasta", "24:00");
    expect(alerts()).toEqual([]);
    click(/^Guardar/);
    expect(latest?.activities[0]?.preferred).toEqual({ start: 1200, end: 1440 });
    fireEvent.click(screen.getByRole("button", { name: /Cálculo II/ }));
    expect((screen.getByLabelText("hasta") as HTMLInputElement).value).toBe("00:00");
    expect(alerts()).toEqual([]);
    set("Prefiero desde", "19:00");
    set("hasta", "00:00");
    click(/^Guardar/);
    expect(latest?.activities[0]?.preferred).toEqual({ start: 1140, end: 1440 });
  });
});

describe("5. Partes del silo", () => {
  it("a name too long is refused with its limit", () => {
    const out = parseUnit(`${"a".repeat(81)} (60)`);
    expect(out && "error" in out && out.error).toMatch(/80/);
    expect(parseUnit("a".repeat(80))).toEqual({ title: "a".repeat(80), minutes: 60 });
  });

  it("a final parenthesis that is not a number is part of the name", () => {
    expect(parseUnit("Parte B (opcional)")).toEqual({ title: "Parte B (opcional)", minutes: 60 });
    expect(parseUnit("Parte B (opcional) (45)")).toEqual({
      title: "Parte B (opcional)",
      minutes: 45,
    });
    const bad = parseUnit("Práctico 5 (70000)");
    expect(bad && "error" in bad).toBe(true);
  });

  it("the editor says it in the field", () => {
    inside(<TaskEditor onClose={() => {}} />);
    set("Nombre", "Entrega");
    set("Nueva parte: nombre y minutos entre paréntesis", `${"a".repeat(90)} (60)`);
    click("Agregar");
    expect(alerts().join(" ")).toMatch(/80/);
  });
});

describe("6. Inicio de cuatrimestre", () => {
  it("a semester longer than a year is said in «Termina»", () => {
    inside(<Semester />);
    set("Empieza", "2026-08-01");
    set("Termina", "2030-08-01");
    expect(screen.getByLabelText("Termina").getAttribute("aria-invalid")).toBe("true");
    expect(alerts().join(" ")).toMatch(/12 meses/);
    click("Guardar fechas");
    expect(latest?.preferences?.semester?.end).not.toBe("2030-08-01");
  });

  it("a normal one saves", () => {
    inside(<Semester />);
    set("Empieza", "2026-08-01");
    set("Termina", "2026-12-01");
    click("Guardar fechas");
    expect(latest?.preferences?.semester).toEqual({ start: "2026-08-01", end: "2026-12-01" });
  });
});

describe("7. Bandeja: el foco después de «Deshacer»", () => {
  const MON = zonedInstant(TIMEZONE, "2026-11-02", 17 * 60 + 50);
  const seeded = (now: number) =>
    seedHistory({ ...demoData(now), preferences: { holidaysOff: false } }, now);

  it("goes to the restored block, not to <body>", () => {
    localStorage.setItem("critical.mode", "demo");
    render(<App fixedNow={MON} initial={seeded} />);
    fireEvent.click(screen.getByRole("button", { name: /Bandeja/ }));
    const done = screen.getAllByLabelText(/^Hecho:/)[0] as HTMLElement;
    tapDone(done);
    const undo = screen.getByRole("button", { name: "Deshacer" });
    undo.focus();
    act(() => {
      fireEvent.click(undo);
    });
    const active = document.activeElement as HTMLElement;
    expect(active).not.toBe(document.body);
    // The block that came back, or the screen title.
    const place = active.closest("[data-block-id]") ?? active.closest("h1");
    expect(place).not.toBeNull();
  });
});

describe("2. «Quedarme con el mínimo» hace lo que dice", () => {
  /**
   * Parcial Cálculo II with study already logged, as in the tester's demo. The record
   * declares a part, so it counts as done (SPEC §3): the figures are those of 17th round.
   */
  const scenario = (study: number) => {
    // The load the demo had before breaks counted whole (SPEC §18.17), where this was tuned.
    const base = reducer(withBreaksOnTop(demoData(NOW)), { type: "refresh", now: NOW });
    const withStudy = {
      ...base,
      checkIns: [
        {
          id: "c1",
          blockId: "b1",
          taskId: "parcial-calc",
          status: "done" as const,
          minutesDone: study,
          createdAt: NOW - 3_600_000,
          unitIds: ["u1"],
        },
      ],
    };
    return reducer(withStudy, { type: "refresh", now: NOW });
  };

  it.each([330, 390])("what it offers, choosing it leaves no target short (%i)", (study) => {
    const d = scenario(study);
    const r = refreshPlan(d, NOW);
    expect(r.result.feasible).toBe(true);
    const offered = decisions(r.input, r.result, { data: d, now: NOW }).options;
    const option = offered.find((o) => o.kind === "minimum-only");
    if (!option) return;
    const after = reducer(d, { type: "applyOption", optionId: option.id, now: NOW });
    const again = refreshPlan(after, NOW);
    expect(again.result.status.filter((s) => s.targetDeficit > 0)).toEqual([]);
  });

  it("is not offered when choosing it would change nothing", () => {
    const d = scenario(330);
    const r = refreshPlan(d, NOW);
    // The target is short, but the parts hold what is left: a lower estimate cuts nothing.
    expect(r.result.status.some((s) => s.targetDeficit > 0)).toBe(true);
    const offered = decisions(r.input, r.result, { data: d, now: NOW }).options;
    expect(offered.map((o) => o.kind)).not.toContain("minimum-only");
  });

  it("the card of a target option does not claim the minimums were the problem", () => {
    const d = scenario(390);
    render(
      <StoreProvider initial={() => d} persist={false} fixedNow={NOW}>
        <ToastProvider>
          <Inbox />
        </ToastProvider>
      </StoreProvider>,
    );
    expect(screen.queryByText("Con esto llegás a todos los mínimos.")).toBeNull();
    expect(screen.getByText(/Con esto el plan cubre todo lo que queda/)).toBeTruthy();
  });
});
