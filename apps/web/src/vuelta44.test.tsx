import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { exportJson, parseBackup } from "./backup.js";
import { TIMEZONE } from "./demo.js";
import { DEMO_KIND_KEY } from "./demoPruebas.js";
import { joinList, zonedInstant } from "./engine.js";
import { hours } from "./format.js";
import { optionTitle } from "./friendly.js";
import type { AppData } from "./model.js";
import { decisions, progress, refreshPlan, shownTotal } from "./planning.js";
import { loadDemo, reducer } from "./store.js";

// 44.ª vuelta (SPEC §18 punto 19): la burbuja usa el mismo total que el silo, la fecha de
// «empezar antes» no deja coma, los mínimos que guardan las opciones son de a 15 min, «Un
// poco de todo» no se ofrece dos veces, las listas se leen «A, B y C» y un respaldo con mínimo
// mayor que lo estimado se importa con el mínimo recortado.
const FIXED = zonedInstant(TIMEZONE, "2026-11-23", 7 * 60);
const instants = (): [string, number][] => [
  ["lunes temprano", FIXED],
  ["miércoles 09:00", zonedInstant(TIMEZONE, "2026-11-25", 9 * 60)],
  ["jueves 20:00", zonedInstant(TIMEZONE, "2026-11-26", 20 * 60)],
  ["hoy, con la fecha real", Date.now()],
];

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function start(now: number): AppData {
  localStorage.setItem(DEMO_KIND_KEY, "pruebas");
  return reducer(loadDemo(now), { type: "refresh", now });
}

describe("1. la burbuja del bloque dice el mismo total que el silo", () => {
  it("Parcial Cálculo II: «Faltan Xh de Yh» con Y = lo del silo", () => {
    localStorage.setItem("critical.mode", "demo");
    localStorage.setItem(DEMO_KIND_KEY, "pruebas");
    render(<App fixedNow={FIXED} initial={loadDemo} />);
    const data = start(FIXED);
    const p = progress(data, FIXED).find((x) => x.task.title === "Parcial Cálculo II");
    if (!p) throw new Error("no progress");
    let said = "";
    for (const pill of document.querySelectorAll<HTMLElement>(".pill.planned")) {
      fireEvent.click(pill);
      const heading = document.querySelector(".bubble h3")?.textContent;
      if (heading === "Parcial Cálculo II") {
        said = document.querySelector(".bubble")?.textContent ?? "";
        break;
      }
      fireEvent.keyDown(document, { key: "Escape" });
    }
    expect(said).toContain(`de ${hours(shownTotal(p))}`);
    expect(shownTotal(p)).toBeLessThanOrEqual(p.totalMinutes);
  });
});

describe("2. «Empezar X antes» no termina en coma", () => {
  it.each(instants())("%s", (_n, now) => {
    const data = start(now);
    const plan = refreshPlan(data, now);
    const labels = decisions(plan.input, plan.result, { data, now }).options.map((o) => o.label);
    for (const l of labels) expect(l, l).not.toMatch(/[,\s]$/);
  });
});

describe("4 y 5. opciones de a 15 min; «Un poco de todo» no se repite", () => {
  const harsh = (now: number): AppData => {
    const d = start(now);
    return {
      ...d,
      tasks: d.tasks.map((t) =>
        t.kind === "habit" || t.minMinutes <= 0
          ? t
          : {
              ...t,
              estimateMinutes: Math.round((t.estimateMinutes * 1.5) / 15) * 15,
              minMinutes: Math.round((t.minMinutes * 1.5) / 15) * 15 + 7,
            },
      ),
    };
  };

  it.each(instants())(
    "%s: lo que guardan es múltiplo de 15 y no se ofrece otra igual",
    (_n, now) => {
      let data = harsh(now);
      let proportionals = 0;
      for (let i = 0; i < 4; i++) {
        const plan = refreshPlan(data, now);
        const offered = decisions(plan.input, plan.result, { data, now }).options;
        const pick =
          offered.find((o) => o.kind === "proportional") ??
          offered.find((o) => o.kind === "lower-minimum");
        if (!pick) break;
        const before = data;
        data = reducer(data, { type: "applyOption", optionId: pick.id, now });
        for (const t of data.tasks) {
          const was = before.tasks.find((x) => x.id === t.id);
          if (!was) continue;
          if (t.minMinutes !== was.minMinutes) {
            expect(t.minMinutes % 15, `${t.title} mínimo`).toBe(0);
            expect(t.minMinutes).toBeLessThanOrEqual(was.minMinutes);
          }
          if (t.estimateMinutes !== was.estimateMinutes) expect(t.estimateMinutes % 15).toBe(0);
        }
        if (pick.kind === "proportional") {
          proportionals++;
          const again = refreshPlan(data, now);
          const next = decisions(again.input, again.result, { data, now }).options;
          expect(next.some((o) => o.kind === "proportional")).toBe(false);
        }
      }
      if (now === FIXED) expect(proportionals).toBeGreaterThan(0);
    },
  );
});

describe("9. respaldo con el mínimo mayor que lo estimado", () => {
  it("al exportar y al importar el mínimo se recorta al estimado", () => {
    const d = start(FIXED);
    const i = d.tasks.findIndex((t) => t.kind === "deliverable");
    const bad = {
      ...d,
      tasks: d.tasks.map((t, k) => (k === i ? { ...t, estimateMinutes: 100, minMinutes: 200 } : t)),
    };
    const exported = JSON.parse(exportJson(bad, FIXED));
    expect(exported.data.tasks[i].minMinutes).toBe(100);
    const read = parseBackup(
      JSON.stringify({ app: "critiCal", version: 2, exportedAt: FIXED, data: bad }),
    );
    if ("error" in read) throw new Error(read.error);
    expect(read.data.tasks[i]?.minMinutes).toBe(100);
  });
});

describe("6. listas de tres o más", () => {
  it("«A», «B» y «C»", () => {
    expect(joinList(["«A»", "«B»", "«C»"])).toBe("«A», «B» y «C»");
    expect(joinList(["«A»", "«B»"])).toBe("«A» y «B»");
    expect(joinList(["«A»"])).toBe("«A»");
  });
});

describe("8. el título no promete llegar si algo queda afuera", () => {
  it("«Usar tiempo libre para llegar» pasa a «Usar tiempo libre»", () => {
    const free = { kind: "use-free-time", label: "Usar tiempo libre para llegar" };
    expect(optionTitle({ ...free, result: { feasible: false } })).toBe("Usar tiempo libre");
    expect(optionTitle({ ...free, result: { feasible: true } })).toBe(free.label);
  });
});
