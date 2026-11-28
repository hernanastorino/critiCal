import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportJson, parseBackup } from "./backup.js";
import { DetectedDefaults } from "./components/Preferences.js";
import { TaskDetail } from "./components/TaskDetail.js";
import { TaskEditor } from "./components/TaskEditor.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { clearDrafts } from "./drafts.js";
import { zonedInstant } from "./engine.js";
import type { AppData, AppTask } from "./model.js";
import { reducer, StoreProvider } from "./store.js";
import { syllabusTasks } from "./syllabus.js";
import { detectedProblem, habitProblems, parseUnit, UNIT_MINUTES_MAX } from "./taskForm.js";

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

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  clearDrafts();
});

const plainTask = (estimateMinutes: number): AppTask => {
  const base = demoData(NOW).tasks.find((t) => t.units.length === 0 && t.kind === "deliverable");
  return {
    ...(base as AppTask),
    id: "plain",
    units: [],
    estimateMinutes,
    minMinutes: Math.min(30, estimateMinutes),
  };
};
const withTask = (t: AppTask) => (now: number) => {
  const d = demoData(now);
  return { ...d, tasks: [...d.tasks, t] };
};
const roundTrip = (d: AppData) => parseBackup(exportJson(d, NOW));

describe("1. Avance por temas: un límite de partes", () => {
  const log = (est: number, topics: number) =>
    reducer(withTask(plainTask(est))(NOW), {
      type: "logProgress",
      taskId: "plain",
      minutes: 0,
      topics,
      now: NOW,
    });

  it("30 h in 1 topic makes a part the backup takes back", () => {
    expect(roundTrip(log(1800, 1))).toHaveProperty("data");
  });

  it("many topics never make a part of 0 min, and the file still imports", () => {
    const out = log(120, 500);
    const task = out.tasks.find((t) => t.id === "plain") as AppTask;
    expect(task.units.every((u) => u.estimateMinutes >= 1)).toBe(true);
    expect(roundTrip(out)).toHaveProperty("data");
  });

  it("the form says topics cannot be more than the minutes", () => {
    const task = plainTask(120);
    inside(<TaskDetail task={task} onEdit={() => {}} onClose={() => {}} />, withTask(task));
    set("Temas en total", "500");
    expect(screen.getByLabelText("Temas en total").getAttribute("aria-invalid")).toBe("true");
    expect(alerts().join(" ")).toMatch(/120/);
    set("Temas en total", "120");
    expect(screen.getByLabelText("Temas en total").getAttribute("aria-invalid")).toBeNull();
  });

  it("the form's parts and the backup share one maximum", () => {
    expect(parseUnit(`Parte (${UNIT_MINUTES_MAX})`)).toEqual({
      title: "Parte",
      minutes: UNIT_MINUTES_MAX,
    });
    expect(parseUnit(`Parte (${UNIT_MINUTES_MAX + 1})`)).toHaveProperty("error");
    const part = (m: number) => {
      const t = plainTask(60_000);
      t.units = [{ id: "u", title: "p", estimateMinutes: m }];
      return roundTrip(withTask(t)(NOW));
    };
    expect(part(UNIT_MINUTES_MAX)).toHaveProperty("data");
    expect(part(UNIT_MINUTES_MAX + 1)).toHaveProperty("error");
    expect(part(0)).toHaveProperty("error");
  });
});

describe("2. Programa: unidades de 0 h", () => {
  const plan = (hours: number[]) => {
    let n = 0;
    return syllabusTasks({
      subject: "Materia nueva",
      activities: [],
      assessments: [
        {
          title: "Parcial",
          kind: "parcial",
          date: "2026-12-20",
          units: hours.map((h, i) => ({ title: `U${i}`, minutes: h * 60 })),
          minutes: 600,
        },
      ],
      timeZone: TIMEZONE,
      newId: () => `id${++n}`,
      color: "#112233",
    });
  };

  it("does not create a part for a unit of 0 h", () => {
    const { tasks } = plan([0, 3]);
    expect((tasks[0] as AppTask).units.map((u) => u.title)).toEqual(["U1"]);
  });

  it("what the program makes imports back, even at 200 h per unit", () => {
    const { activity, tasks } = plan([0, 200, 200]);
    const d = demoData(NOW);
    const out = roundTrip({
      ...d,
      activities: [...d.activities, activity],
      tasks: [...d.tasks, ...tasks],
    });
    expect(out).toHaveProperty("data");
  });
});

describe("3. parseBackup says what fails and where", () => {
  const withChange = (change: (t: AppTask) => AppTask) => {
    const d = structuredClone(demoData(NOW));
    const i = d.tasks.findIndex((t) => t.units.length > 1);
    d.tasks[i] = change(d.tasks[i] as AppTask);
    return roundTrip(d);
  };
  const errorOf = (r: ReturnType<typeof parseBackup>) => ("error" in r ? r.error : "");

  it("names the part of 0 min", () => {
    const r = withChange((t) => ({
      ...t,
      units: [{ ...(t.units[0] as AppTask["units"][0]), estimateMinutes: 0 }],
    }));
    expect(errorOf(r)).toMatch(/tiene una parte de 0 min/);
  });
  it("names repeated part ids", () => {
    const r = withChange((t) => ({ ...t, units: [t.units[0], t.units[0]] as AppTask["units"] }));
    expect(errorOf(r)).toMatch(/Hay dos partes con el mismo id en "/);
  });
  it("reads a minimum above the estimate cut to it", () => {
    const r = withChange((t) => ({ ...t, estimateMinutes: 100, minMinutes: 200 }));
    expect(r).toHaveProperty("data");
  });
  it("names a date out of range", () => {
    const r = withChange((t) => ({ ...t, deadline: Date.UTC(1990, 0, 1) }));
    expect(errorOf(r)).toMatch(/La fecha de ".*" está fuera de 2000–2031/);
  });
});

describe("6. maxDuration de las funciones lentas", () => {
  it("covers every function that calls an outside service", () => {
    const conf = JSON.parse(readFileSync(resolve(__dirname, "../vercel.json"), "utf8")) as {
      functions: Record<string, { maxDuration: number }>;
    };
    for (const f of ["cron", "account", "google-sync", "icloud-sync", "google-webhook"]) {
      expect(conf.functions[`api/${f}.ts`]?.maxDuration).toBe(60);
      expect(() => readFileSync(resolve(__dirname, `../api/${f}.ts`))).not.toThrow();
    }
  });
});

describe("7. Horas para lo detectado", () => {
  it("0 h is an error in the hours field", () => {
    expect(detectedProblem("0", "0")).toMatchObject({ field: "estimate" });
    expect(detectedProblem("2", "0")).toBeNull();
  });
  it("the form says it and does not save", () => {
    inside(<DetectedDefaults />);
    const hoursField = screen.getAllByLabelText(/^Horas de /)[0] as HTMLElement;
    fireEvent.change(hoursField, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar horas" }));
    expect(hoursField.getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByText("Horas guardadas")).toBeNull();
  });
});

describe("8. Hábito: horas como en el resto", () => {
  it("says 233h20, not 233.3 h", () => {
    const { minutes } = habitProblems("14", "1000", 0, false);
    expect(minutes).toMatch(/233h20/);
    expect(minutes).not.toMatch(/233\.3/);
  });
});

describe("9. Nueva entrega con dos errores", () => {
  it("announces once, and the fields point at their text", () => {
    inside(<TaskEditor onClose={() => {}} />);
    set("Nombre", "Entrega");
    set("Horas estimadas", "abc");
    set("Mínimo (horas)", "xyz");
    expect(screen.getByLabelText("Horas estimadas").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Mínimo (horas)").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    const id = screen.getByLabelText("Horas estimadas").getAttribute("aria-describedby") as string;
    expect(document.getElementById(id)?.textContent).toMatch(/horas/);
  });
});
