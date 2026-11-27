import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockSheet } from "./components/BlockSheet.js";
import { ToastProvider } from "./components/Toast.js";
import { emptyData, TIMEZONE } from "./demo.js";
import { zonedInstant } from "./engine.js";
import type { AppData, AppTask } from "./model.js";
import { progress } from "./planning.js";
import { StoreProvider, useStore } from "./store.js";
import { weekLeft } from "./week-review.js";

// 41.ª vuelta (SPEC §18.15): el descanso cuenta y un silo lee «falta / asignado».
const seen: { store?: ReturnType<typeof useStore> } = {};
const Probe = () => {
  seen.store = useStore();
  return null;
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const WEDNESDAY = zonedInstant(TIMEZONE, "2026-11-25", 15 * 60);
const instants = (): [string, number][] => [
  ["miércoles 15:00", WEDNESDAY],
  ["hoy, con la fecha real", Date.now()],
];

/** A materia with the default 50 + 10 break and one task of `hours` hours, no parts. */
function scenario(now: number, hours: number) {
  const task: AppTask = {
    id: "t",
    activityId: "m",
    title: "Parcial Física I",
    kind: "deliverable",
    deadline: now + 5 * 86_400_000,
    estimateMinutes: hours * 60,
    minMinutes: hours * 60,
    priority: 2,
    status: "active",
    units: [],
  };
  // A one-hour block that ended before `now`, on the same local day.
  const block = {
    id: "b1",
    taskId: "t",
    activityId: "m",
    start: now - 2 * 3_600_000,
    end: now - 3_600_000,
    level: "ok" as const,
  };
  const data: AppData = {
    ...emptyData(),
    activities: [
      {
        id: "m",
        name: "Física",
        color: "#0a84ff",
        academic: true,
        maxSessionMinutes: 120,
        minBlockMinutes: 60,
      },
    ],
    tasks: [task],
    plan: [block],
  };
  return { data, block };
}

const leftOf = (d: AppData, now: number) =>
  progress(d, now).find((p) => p.task.id === "t")?.remainingMinutes;

function openSheet(data: AppData, now: number, block: AppData["plan"][number]) {
  render(
    <StoreProvider initial={() => data} persist={false} fixedNow={now}>
      <ToastProvider>
        <Probe />
        <BlockSheet
          item={{ kind: "block", id: block.id, start: block.start, end: block.end, block }}
          onClose={vi.fn()}
        />
      </ToastProvider>
    </StoreProvider>,
  );
}

describe("El descanso cuenta: un bloque de 1h son 60 min", () => {
  it.each(instants())("%s: Hecho cuenta 60 min", (_n, now) => {
    const { data, block } = scenario(now, 2);
    openSheet(data, now, block);
    fireEvent.click(screen.getByRole("button", { name: "Hecho" }));
    const saved = seen.store?.data.checkIns.at(-1);
    expect(saved?.minutesDone).toBe(60);
    expect(seen.store && leftOf(seen.store.data, now)).toBe(60);
  });

  it.each(instants())("%s: el slider da 30 / 6 / 54 min con 50 / 10 / 90 %%", (_n, now) => {
    for (const [percent, minutes] of [
      [50, 30],
      [10, 6],
      [90, 54],
    ] as const) {
      cleanup();
      const { data, block } = scenario(now, 2);
      openSheet(data, now, block);
      fireEvent.click(screen.getByRole("button", { name: "Parcial" }));
      fireEvent.change(screen.getByRole("slider"), { target: { value: String(percent) } });
      fireEvent.click(screen.getByRole("button", { name: "Guardar parcial" }));
      expect(seen.store?.data.checkIns.at(-1)?.minutesDone).toBe(minutes);
      expect(seen.store && leftOf(seen.store.data, now)).toBe(120 - minutes);
    }
  });

  it("un registro viejo con factor 1,2 cuenta sus minutos enteros", () => {
    const { data } = scenario(WEDNESDAY, 2);
    const old = {
      ...data,
      checkIns: [
        {
          id: "c",
          blockId: "b1",
          taskId: "t",
          status: "done" as const,
          minutesDone: 60,
          unitIds: [],
          createdAt: WEDNESDAY,
          factor: 1.2,
        },
      ],
    };
    expect(leftOf(old, WEDNESDAY)).toBe(60);
  });
});

describe("«Falta / asignado» de la semana", () => {
  it("2h sin avance dicen 2h / 2h; con un bloque hecho, 1h / 2h", () => {
    const { data, block } = scenario(WEDNESDAY, 2);
    expect(weekLeft(data, WEDNESDAY).find((r) => r.taskId === "t")).toMatchObject({
      left: 120,
      assigned: 120,
    });
    const done = {
      ...data,
      checkIns: [
        {
          id: "c",
          blockId: block.id,
          taskId: "t",
          status: "done" as const,
          minutesDone: 60,
          unitIds: [],
          createdAt: WEDNESDAY,
        },
      ],
    };
    expect(weekLeft(done, WEDNESDAY).find((r) => r.taskId === "t")).toMatchObject({
      left: 60,
      assigned: 120,
    });
  });

  it("completada dice 0h / 2h", () => {
    const { data, block } = scenario(WEDNESDAY, 2);
    const done = {
      ...data,
      checkIns: [
        {
          id: "c",
          blockId: block.id,
          taskId: "t",
          status: "done" as const,
          minutesDone: 120,
          unitIds: [],
          createdAt: WEDNESDAY,
        },
      ],
    };
    expect(weekLeft(done, WEDNESDAY).find((r) => r.taskId === "t")).toMatchObject({
      left: 0,
      assigned: 120,
    });
  });
});
