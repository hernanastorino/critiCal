import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { edited, errorOf } from "./atacante11Kit.js";
import { Inbox } from "./components/Inbox.js";
import { ToastProvider, UNDO_MS, useToast } from "./components/Toast.js";
import { WeeklyPlan } from "./components/WeeklyPlan.js";
import { demoData, emptyData, TIMEZONE } from "./demo.js";
import { zonedInstant } from "./engine.js";
import type { AppData } from "./model.js";
import { StoreProvider } from "./store.js";
import { runningSince } from "./testing.js";
import { type WeekFormValues, weekProblems } from "./weekForm.js";

afterEach(cleanup);

const ok: WeekFormValues = {
  wake: "07:00",
  morning: "30",
  breakfast: "07:30",
  breakfastMin: "20",
  lunch: "13:00",
  lunchMin: "60",
  snack: "17:30",
  snackMin: "0",
  dinner: "21:00",
  dinnerMin: "30",
  freeFrom: "22:00",
  bed: "23:00",
};

describe("Mi semana: los dos errores de una misma fila salen juntos", () => {
  it("almuerzo «abc» con duración −60 marca la hora y la duración", () => {
    const found = weekProblems({ ...ok, lunch: "abc", lunchMin: "-60" });
    expect(found.map((p) => p.fields[0]).sort()).toEqual(["Almuerzo", "Dura (min), almuerzo"]);
  });

  it("cena 03:00 con duración 5000 marca la duración y la hora (dormido)", () => {
    const found = weekProblems({ ...ok, dinner: "03:00", dinnerMin: "5000" });
    expect(found.map((p) => p.fields[0]).sort()).toEqual(["Cena", "Dura (min), cena"]);
  });

  it("una duración en blanco o 0 sigue sacando la comida de la cuenta", () => {
    expect(weekProblems({ ...ok, lunch: "abc", lunchMin: "0" })).toEqual([]);
    expect(weekProblems({ ...ok, lunch: "abc", lunchMin: "" })).toEqual([]);
  });
});

describe("Planificación semanal no contradice a la Bandeja", () => {
  const MON = zonedInstant("America/Montevideo", "2026-11-02", 6 * 60);
  const tooShort = (): AppData => {
    const base = demoData(MON);
    const routine = {
      id: "run",
      name: "Correr",
      color: "#0a0",
      academic: false,
      kind: "rutina" as const,
      maxSessionMinutes: 60,
      minBlockMinutes: 60,
      validHours: { all: { start: 7 * 60 + 10, end: 8 * 60 + 10 } },
    };
    const habit = {
      id: "runh",
      activityId: "run",
      title: "Correr",
      kind: "habit" as const,
      estimateMinutes: 60,
      minMinutes: 60,
      priority: 2 as const,
      status: "active" as const,
      sessionsPerWeek: 3,
      sessionMinutes: 60,
      units: [],
    };
    return runningSince(
      { ...base, activities: [...base.activities, routine], tasks: [...base.tasks, habit] },
      MON,
    );
  };

  it("con tareas que no entran dice cuántas en vez de «hay margen en todo»", () => {
    render(
      <StoreProvider initial={tooShort} persist={false} fixedNow={MON}>
        <WeeklyPlan onClose={vi.fn()} onInbox={vi.fn()} />
      </StoreProvider>,
    );
    expect(screen.getByText(/No llegás a todo: \d+ tareas? no entra/)).toBeTruthy();
    expect(screen.queryByText(/hay margen en todo/)).toBeNull();
    expect(screen.getByRole("button", { name: /Ver la Bandeja/ })).toBeTruthy();
  }, 30_000);

  it("sin tareas que no entran sigue diciendo que hay margen", () => {
    render(
      <StoreProvider initial={emptyData} persist={false} fixedNow={MON}>
        <WeeklyPlan onClose={vi.fn()} onInbox={vi.fn()} />
      </StoreProvider>,
    );
    expect(screen.queryByText(/No llegás a todo/)).toBeNull();
    expect(screen.getByText(/hay margen en todo/)).toBeTruthy();
  });
});

function Pair({ first, second }: { first: () => void; second: () => void }) {
  const toast = useToast();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          toast.show("Primero", { undo: first });
        }}
      >
        Uno
      </button>
      <button
        type="button"
        onClick={() => {
          toast.show("Segundo", { undo: second });
        }}
      >
        Dos
      </button>
      <button
        type="button"
        onClick={() => {
          toast.show("Aparte");
        }}
      >
        Aparte
      </button>
    </>
  );
}

describe("avisos con «Deshacer»: se apilan", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
  afterEach(() => vi.useRealTimers());

  const mount = () => {
    const first = vi.fn();
    const second = vi.fn();
    render(
      <ToastProvider>
        <Pair first={first} second={second} />
      </ToastProvider>,
    );
    return { first, second };
  };

  it("el segundo no deja sin deshacer al primero", () => {
    const { first, second } = mount();
    fireEvent.click(screen.getByText("Uno"));
    fireEvent.click(screen.getByText("Dos"));
    expect(screen.getAllByRole("button", { name: "Deshacer" })).toHaveLength(2);
    const older = screen.getAllByRole("button", { name: "Deshacer" }).at(0);
    if (!older) throw new Error("falta el primer Deshacer");
    fireEvent.click(older);
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    expect(screen.queryByText("Primero")).toBeNull();
    expect(screen.getByText("Segundo")).toBeTruthy();
  });

  it("un aviso común reemplaza a lo que había, y cada uno se va a los 4 s", () => {
    mount();
    fireEvent.click(screen.getByText("Uno"));
    act(() => {
      vi.advanceTimersByTime(UNDO_MS - 500);
    });
    fireEvent.click(screen.getByText("Dos"));
    act(() => {
      vi.advanceTimersByTime(600);
    });
    // The first one went on its own time; the second one still has its own.
    expect(screen.queryByText("Primero")).toBeNull();
    expect(screen.getByText("Segundo")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(UNDO_MS);
    });
    expect(screen.queryByText("Segundo")).toBeNull();
    fireEvent.click(screen.getByText("Uno"));
    fireEvent.click(screen.getByText("Aparte"));
    expect(screen.queryByText("Primero")).toBeNull();
  });

  it("un toque (puntero táctil) no lo retiene: se va a los 4 s", () => {
    mount();
    fireEvent.click(screen.getByText("Uno"));
    fireEvent.pointerEnter(screen.getByText("Primero"), { pointerType: "touch" });
    act(() => {
      vi.advanceTimersByTime(UNDO_MS + 10);
    });
    expect(screen.queryByText("Primero")).toBeNull();
  });
});

describe("respaldo: casa única y horas que se dicen", () => {
  const places = (homes: boolean[]) =>
    homes.map((isHome, i) => ({ id: `p${i}`, name: `Lugar ${i}`, aliases: [], isHome }));

  it("dos lugares marcados como casa se rechazan con un mensaje claro", () => {
    const r = edited([["places", places([true, true])]]);
    expect(errorOf(r)).toBe("El respaldo tiene más de un lugar marcado como casa.");
    expect(errorOf(edited([["places", places([true, false])]]))).toBe("");
  });

  it("horas absurdas de Mi semana dicen qué está mal", () => {
    const r = edited([
      ["settings.week.0.wake", -5000],
      ["settings.week.0.bed", 99999],
    ]);
    expect(errorOf(r)).toBe("Las horas de Mi semana del respaldo no son válidas.");
  });

  it("un huso horario inválido lo dice", () => {
    const r = edited([["settings.timezone", "Marte/Olimpo"]]);
    expect(errorOf(r)).toBe("El huso horario del respaldo no es válido.");
  });
});

describe("¿Dónde es?: «Usar» apagado dice por qué", () => {
  const event = {
    id: "x",
    title: "Inglés",
    start: zonedInstant(TIMEZONE, "2026-11-03", 18 * 60),
    end: zonedInstant(TIMEZONE, "2026-11-03", 19 * 60),
    busy: true,
    location: "Instituto Anglo",
    source: "google" as const,
  };
  const casa = { id: "casa", name: "Casa", aliases: [], isHome: true, address: "Rivera 1234" };

  it("con el nombre en blanco (espacios o invisibles) avisa", () => {
    localStorage.clear();
    render(
      <StoreProvider
        initial={() => ({ ...emptyData(), places: [casa], events: [event] })}
        persist
        fixedNow={zonedInstant(TIMEZONE, "2026-11-03", 8 * 60)}
      >
        <Inbox />
      </StoreProvider>,
    );
    fireEvent.change(screen.getByLabelText("O minutos desde casa para Inglés"), {
      target: { value: "15" },
    });
    fireEvent.click(screen.getByLabelText("Guardar como lugar"));
    expect(screen.getByRole("alert").textContent).toBe("Poné un nombre para el lugar.");
    fireEvent.change(screen.getByLabelText(/^Nombre del lugar/), { target: { value: " ​ " } });
    expect(screen.getByRole("alert").textContent).toBe("Poné un nombre para el lugar.");
    fireEvent.change(screen.getByLabelText(/^Nombre del lugar/), { target: { value: "Anglo" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
