import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorOf, NOW, plain, roundTrip } from "./atacante11Kit.js";
import { exportJson } from "./backup.js";
import { Backup } from "./components/Backup.js";
import { Places } from "./components/Places.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData } from "./demo.js";
import { clearDrafts } from "./drafts.js";
import { ESTIMATE_MINUTES_MAX } from "./limits.js";
import { type AppData, type AppTask, newId } from "./model.js";
import { spotKey } from "./places.js";
import { reducer, StoreProvider, useStore } from "./store.js";
import { syllabusTasks } from "./syllabus.js";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  clearDrafts();
});

describe("1. Estudio semanal de 0 a 168 h", () => {
  it.each([0.5, 1, 14, 15, 40, 100, 168])("%s h a la semana: ida y vuelta idéntica", (hours) => {
    const out = reducer(demoData(NOW), {
      type: "weeklyStudy",
      activityId: "calc",
      minutes: Math.round(hours * 60),
      now: NOW,
    });
    const back = roundTrip(out);
    expect(errorOf(back)).toBe("");
    expect("data" in back && back.data).toEqual(plain(out));
  });
});

describe("2. Texto largo y eventos grandes", () => {
  it("an event with a 400-character title and a 400-day span imports, title trimmed", () => {
    const d = demoData(NOW);
    const long: AppData = {
      ...d,
      events: [
        ...d.events,
        {
          id: "google:largo",
          title: "T".repeat(400),
          start: NOW,
          end: NOW + 400 * 86_400_000,
          busy: false,
          allDay: true,
          source: "google",
        },
      ],
    };
    const back = roundTrip(long);
    expect(errorOf(back)).toBe("");
    const events = "data" in back ? back.data.events : [];
    expect(events).toHaveLength(long.events.length);
    const found = events.find((e) => e.id === "google:largo");
    expect(found?.title).toHaveLength(300);
    expect(found?.end).toBe(NOW + 400 * 86_400_000);
    // Everything else comes back as it was.
    expect("data" in back && back.data.tasks).toEqual(plain(long.tasks));
  });

  it("saving an event address as a place keeps its alias short", () => {
    const address = "Calle ".repeat(100);
    const d: AppData = {
      ...demoData(NOW),
      spots: [{ key: spotKey(address), text: address, minutes: 10 }],
    };
    const out = reducer(d, {
      type: "saveSpot",
      key: spotKey(address),
      name: "N".repeat(200),
      now: NOW,
    });
    const place = out.places?.at(-1);
    expect(place?.aliases[0]?.length).toBeLessThanOrEqual(300);
    expect(place?.name.length).toBeLessThanOrEqual(60);
    expect(errorOf(roundTrip(out))).toBe("");
  });

  it("the place form refuses an alias over the limit", () => {
    render(
      <ToastProvider>
        <StoreProvider initial={() => demoData(NOW)} persist={false} fixedNow={NOW}>
          <Places />
        </StoreProvider>
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("Agregar lugar"));
    fireEvent.change(screen.getByPlaceholderText("Facu"), { target: { value: "Gym" } });
    fireEvent.change(screen.getByPlaceholderText("FING, Facultad"), {
      target: { value: `corto, ${"a".repeat(400)}` },
    });
    fireEvent.click(screen.getByText("Guardar"));
    expect(screen.getByRole("alert").textContent).toMatch(/alias.*300/i);
  });
});

describe("5. Topes de horas coherentes", () => {
  it("the longest silo of the form fits the backup", () => {
    const d = demoData(NOW);
    const base = d.tasks.find((t) => t.kind === "deliverable");
    if (!base) throw new Error("the demo has no deliverable");
    const task: AppTask = {
      ...base,
      id: "gran",
      units: [],
      estimateMinutes: ESTIMATE_MINUTES_MAX,
      minMinutes: ESTIMATE_MINUTES_MAX,
    };
    expect(errorOf(roundTrip({ ...d, tasks: [...d.tasks, task] }))).toBe("");
  });

  it("an assessment of 40 units of 200 h is cut to what the backup takes", () => {
    const units = Array.from({ length: 40 }, (_, i) => ({ title: `U${i}`, minutes: 200 * 60 }));
    const { tasks, activity } = syllabusTasks({
      subject: "Física",
      activities: [],
      assessments: [{ title: "Examen", kind: "parcial", date: "2027-02-01", units, minutes: 0 }],
      timeZone: demoData(NOW).settings.timezone,
      newId,
      color: "#FF8A00",
    });
    const task = tasks[0];
    if (!task) throw new Error("no task");
    const parts = task.units.reduce((sum, u) => sum + u.estimateMinutes, 0);
    expect(task.estimateMinutes).toBeLessThanOrEqual(ESTIMATE_MINUTES_MAX);
    expect(parts).toBeLessThanOrEqual(ESTIMATE_MINUTES_MAX);
    expect(
      task.units.every((u) => Number.isInteger(u.estimateMinutes) && u.estimateMinutes >= 1),
    ).toBe(true);
    const d: AppData = {
      ...demoData(NOW),
      activities: [activity],
      tasks: [task],
      plan: [],
      checkIns: [],
      proposals: [],
      pins: [],
    };
    expect(errorOf(roundTrip(d))).toBe("");
  });
});

function Probe() {
  const { data } = useStore();
  return <output aria-label="dueño">{data.owner ?? "ninguno"}</output>;
}

describe("6. El dueño del respaldo pasa a ser la cuenta actual", () => {
  it("importing another account's file keeps this account as the owner", async () => {
    vi.useRealTimers();
    // With an account the ids are uuids.
    const demo = demoData(NOW);
    const ids = new Map<string, string>();
    const everyId = [...demo.activities, ...demo.tasks, ...demo.tasks.flatMap((t) => t.units)];
    for (const { id } of everyId) ids.set(id, newId());
    const withUuids = (d: AppData): AppData => {
      let json = JSON.stringify(d);
      for (const [from, to] of ids) json = json.split(`"${from}"`).join(`"${to}"`);
      return JSON.parse(json);
    };
    render(
      <ToastProvider>
        <StoreProvider
          initial={() => ({ ...withUuids(demo), owner: "yo" })}
          persist={false}
          fixedNow={NOW}
        >
          <Backup />
          <Probe />
        </StoreProvider>
      </ToastProvider>,
    );
    const theirs = exportJson({ ...withUuids(demo), owner: "otra-cuenta" }, NOW);
    const file = new File([theirs], "respaldo.json", { type: "application/json" });
    await act(() => {
      fireEvent.change(screen.getByLabelText("Archivo de respaldo"), { target: { files: [file] } });
      return Promise.resolve();
    });
    await screen.findByText("Datos importados");
    expect(screen.getByLabelText("dueño").textContent).toBe("yo");
  });
});
