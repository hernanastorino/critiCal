import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./components/modal.js";
import { demoData } from "./demo.js";
import { zonedInstant } from "./engine.js";
import { reducer } from "./store.js";

const tz = "America/Montevideo";
const NOW = zonedInstant(tz, "2026-11-04", 8 * 60);

describe("36.ª vuelta: borrar un lugar o una rutina deja ↶ arriba", () => {
  afterEach(cleanup);

  it("borrar un lugar se deshace desde la flecha, con su dirección y sus traslados", () => {
    const start = reducer(demoData(NOW), {
      type: "savePlace",
      place: { id: "club", name: "Club Remeros", aliases: [], address: "Herrera 3365" },
      now: NOW,
    });
    const gone = reducer(start, { type: "deletePlace", placeId: "club", now: NOW });
    expect(gone.places?.some((p) => p.id === "club")).toBe(false);
    expect(gone.planHistory?.at(-1)?.label).toBe("borrar Club Remeros");
    const back = reducer(gone, { type: "undoPlan", now: NOW });
    expect(back.places?.find((p) => p.id === "club")?.address).toBe("Herrera 3365");
  });

  it("Deshacer del aviso devuelve el lugar y saca su entrada de la cabecera", () => {
    const place = { id: "club", name: "Club Remeros", aliases: [], address: "Herrera 3365" };
    const start = reducer(demoData(NOW), { type: "savePlace", place, now: NOW });
    const before = start.planHistory?.length ?? 0;
    const gone = reducer(start, { type: "deletePlace", placeId: "club", now: NOW });
    const only = gone.planHistory?.at(-1);
    const back = reducer(gone, { type: "restorePlace", place, times: [], only, now: NOW });
    expect(back.places?.some((p) => p.id === "club")).toBe(true);
    expect(back.planHistory?.length).toBe(before);
  });

  it("sin su entrada (ya hubo otro cambio), el aviso igual devuelve el lugar", () => {
    const place = { id: "club", name: "Club Remeros", aliases: [], address: "Herrera 3365" };
    const start = reducer(demoData(NOW), { type: "savePlace", place, now: NOW });
    const gone = reducer(start, { type: "deletePlace", placeId: "club", now: NOW });
    const only = gone.planHistory?.at(-1);
    const later = reducer(gone, { type: "savePlace", place: { ...place, id: "otro" }, now: NOW });
    const back = reducer(later, { type: "restorePlace", place, times: [], only, now: NOW });
    expect(back.places?.some((p) => p.id === "club")).toBe(true);
  });

  const silo = () => {
    const start = demoData(NOW);
    const task = start.tasks.at(0);
    if (!task) throw new Error("sin silos");
    return { start, task };
  };

  it.each(["deleteAll", "endFromToday"] as const)(
    "eliminar un silo (%s) se deshace desde la flecha",
    (change) => {
      const { start, task } = silo();
      const gone = reducer(start, { type: "recurrence", taskId: task.id, change, now: NOW });
      expect(gone.planHistory?.at(-1)?.label).toBe(`eliminar ${task.title}`);
      const back = reducer(gone, { type: "undoPlan", now: NOW });
      const again = back.tasks.find((t) => t.id === task.id);
      expect(again?.status).toBe(task.status);
      expect(again?.endedAt).toBe(task.endedAt);
    },
  );

  it("Deshacer del aviso (restoreState) saca la entrada de la cabecera", () => {
    const { start, task } = silo();
    const gone = reducer(start, {
      type: "recurrence",
      taskId: task.id,
      change: "deleteAll",
      now: NOW,
    });
    const version = gone.planHistory?.at(-1);
    if (!version?.gone) throw new Error("sin entrada");
    const back = reducer(gone, { type: "restoreState", before: version.gone.snap, now: NOW });
    expect(back.tasks.some((t) => t.id === task.id)).toBe(true);
    expect(back.planHistory?.some((v) => v.gone)).toBeFalsy();
  });
});

describe("la flecha bajo el fondo de una hoja", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const montar = (disabled: boolean) => {
    document.body.innerHTML =
      '<div class="scrim"></div><button data-header-undo type="button">↶</button>';
    const btn = document.querySelector<HTMLButtonElement>("button[data-header-undo]");
    if (!btn) throw new Error("sin botón");
    btn.disabled = disabled;
    btn.getBoundingClientRect = () => new DOMRect(300, 10, 40, 40);
    const click = vi.fn();
    btn.addEventListener("click", click);
    return click;
  };
  const tocar = (x: number, y: number) => {
    const scrim = document.querySelector(".scrim");
    if (!scrim) throw new Error("sin fondo");
    scrim.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y }));
  };

  it("un toque sobre la flecha la acciona", () => {
    const click = montar(false);
    tocar(320, 30);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("un toque en otro lado del fondo no la acciona", () => {
    const click = montar(false);
    tocar(100, 300);
    expect(click).not.toHaveBeenCalled();
  });

  it("sin nada que deshacer no hace nada", () => {
    const click = montar(true);
    tocar(320, 30);
    expect(click).not.toHaveBeenCalled();
  });
});
