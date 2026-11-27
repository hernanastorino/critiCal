import { describe, expect, it } from "vitest";
import { TIMEZONE } from "./demo.js";
import { pruebasData } from "./demoPruebas.js";
import { zonedInstant } from "./engine.js";
import type { AppTask, Unit } from "./model.js";
import {
  addRow,
  applySheet,
  byWeight,
  canAccept,
  fillRest,
  fitOf,
  hasWeights,
  markOf,
  openSheet,
  overRow,
  proportional,
  removeRow,
  roundOpen,
  rowSpoken,
  scaleOf,
  slideMin,
  slideRow,
  slideTotal,
  spoken,
  typeTotal,
  unassigned,
} from "./repartir.js";
import { seedHistory } from "./store.js";

const unit = (id: string, minutes: number, extra: Partial<Unit> = {}): Unit => ({
  id,
  title: id,
  estimateMinutes: minutes,
  ...extra,
});

const task = (total: number, min: number, units: Unit[] = []): AppTask => ({
  id: "t",
  activityId: "a",
  title: "Parcial",
  kind: "deliverable",
  deadline: 0,
  estimateMinutes: total,
  minMinutes: min,
  priority: 2,
  status: "active",
  units,
});

const sheet = (total: number, min: number, units: number[]) =>
  openSheet(
    task(
      total,
      min,
      units.map((m, i) => unit(`u${i}`, m)),
    ),
  );

describe("escala y redondeo al abrir", () => {
  it("la escala es el valor × 1,3 redondeado arriba a 15", () => {
    expect(scaleOf(600)).toBe(780);
    expect(scaleOf(100)).toBe(135);
    expect(scaleOf(60)).toBe(90);
    expect(scaleOf(0)).toBe(15);
  });

  it("≤ 5 minutos sobre un múltiplo de 15 baja; más sube", () => {
    expect(roundOpen(50)).toBe(45);
    expect(roundOpen(52)).toBe(60);
    expect(roundOpen(45)).toBe(45);
    expect(roundOpen(65)).toBe(60);
    expect(roundOpen(66)).toBe(75);
    expect(roundOpen(0)).toBe(0);
  });

  it("un tema con minutos no queda en 0 al redondear", () => {
    expect(roundOpen(3)).toBe(15);
    expect(roundOpen(10)).toBe(15);
  });

  it("abre redondeado: el total es lo asignado a los temas", () => {
    const s = sheet(190, 100, [50, 52, 90]);
    expect(s.rows.map((r) => r.minutes)).toEqual([45, 60, 90]);
    expect(s.total).toBe(195);
    expect(s.min).toBe(105);
    expect(unassigned(s)).toBe(0);
    expect(s.rows.map((r) => r.scale)).toEqual([60, 90, 120]);
    expect(s.totalScale).toBe(255);
  });

  it("sin temas el total es el de la tarea, redondeado", () => {
    const s = openSheet(task(250, 130));
    expect(s.total).toBe(255);
    expect(s.min).toBe(135);
    expect(unassigned(s)).toBe(0);
    expect(canAccept(s)).toBe(true);
  });

  it("el mínimo nunca pasa del total al abrir", () => {
    expect(openSheet(task(60, 90)).min).toBe(60);
  });
});

describe("marcas del mínimo", () => {
  it("10 h con mínimo 5 y temas de 8 y 2: marcas en 4 y 1", () => {
    const s = sheet(600, 300, [480, 120]);
    const [a, b] = s.rows;
    expect(markOf(s, a as never)).toBe(240);
    expect(markOf(s, b as never)).toBe(60);
  });

  it("mínimo 4 h de 6 h: 66 % de cada tema", () => {
    const s = sheet(360, 240, [180, 180]);
    const [a] = s.rows;
    expect(markOf(s, a as never) / (a?.minutes ?? 1)).toBeCloseTo(0.6667, 3);
  });

  it("el mínimo se mueve de a 15 y nunca pasa del total", () => {
    const s = sheet(360, 240, [180, 180]);
    expect(slideMin(s, 100).min).toBe(105);
    expect(slideMin(s, 9999).min).toBe(360);
    expect(slideMin(s, -5).min).toBe(0);
  });

  it("un total bajo el mínimo se deja y el mínimo baja a ese valor", () => {
    const s = slideTotal(sheet(360, 240, [180, 180]), 120);
    expect(s.total).toBe(120);
    expect(s.min).toBe(120);
  });
});

describe("el total y los temas", () => {
  it("mover el total no mueve los temas: queda «sin asignar»", () => {
    const s = slideTotal(sheet(360, 240, [180, 180]), 420);
    expect(s.rows.map((r) => r.minutes)).toEqual([180, 180]);
    expect(unassigned(s)).toBe(60);
    expect(canAccept(s)).toBe(false);
  });

  it("subir un tema más allá del total lo pone en rojo y no se acepta", () => {
    let s = sheet(360, 240, [180, 180]);
    s = slideRow(s, "u0", 240);
    expect(unassigned(s)).toBe(-60);
    expect(overRow(s, "u0")).toBe(true);
    expect(overRow(s, "u1")).toBe(false);
    expect(canAccept(s)).toBe(false);
    s = slideRow(s, "u1", 120);
    expect(overRow(s, "u0")).toBe(false);
    expect(canAccept(s)).toBe(true);
  });

  it("escribir un valor lo vuelve el nuevo y recalcula su escala", () => {
    const s = typeTotal(sheet(360, 240, [180, 180]), 600);
    expect(s.total).toBe(600);
    expect(s.totalScale).toBe(780);
    const r = slideRow(s, "u0", 300, true);
    expect(r.rows[0]?.scale).toBe(390);
    // Arrastrar no cambia la escala.
    expect(slideRow(r, "u0", 150).rows[0]?.scale).toBe(390);
  });

  it("sin temas, el total se fija solo", () => {
    const s = slideTotal(openSheet(task(120, 60)), 300);
    expect(unassigned(s)).toBe(0);
    expect(canAccept(s)).toBe(true);
    expect(canAccept(slideTotal(s, 0))).toBe(false);
  });
});

describe("lo hecho", () => {
  const done = (id: string, minutes: number) => unit(id, minutes, { doneAt: 1, doneByHand: true });

  it("un tema completo está bloqueado y no se mueve ni se quita", () => {
    const s = openSheet(task(360, 120, [done("d", 120), unit("p", 240)]));
    expect(s.rows[0]?.locked).toBe(true);
    expect(slideRow(s, "d", 30).rows[0]?.minutes).toBe(120);
    expect(removeRow(s, "d").rows).toHaveLength(2);
    expect(s.totalFloor).toBe(120);
  });

  it("el total no baja de lo hecho (en una tarea sin temas)", () => {
    const s = openSheet(task(300, 60), 100);
    expect(s.totalFloor).toBe(105);
    expect(slideTotal(s, 15).total).toBe(105);
  });

  it("«Repartir el resto» al quitar no baja de lo hecho", () => {
    const s = slideTotal(openSheet(task(360, 120, [done("d", 120), unit("p", 240)])), 150);
    const r = fillRest(s);
    expect(r.rows.map((x) => x.minutes)).toEqual([120, 30]);
  });
});

describe("repartir el resto", () => {
  it("30 minutos entre 3 temas: 15, 15, 0", () => {
    const s = slideTotal(sheet(0, 0, [0, 0, 0]), 30);
    const r = fillRest(s);
    expect(r.rows.map((x) => x.minutes)).toEqual([15, 15, 0]);
    expect(unassigned(r)).toBe(0);
  });

  it("da vueltas de arriba hacia abajo hasta cerrar", () => {
    const s = slideTotal(sheet(60, 30, [15, 15, 15]), 120);
    expect(fillRest(s).rows.map((x) => x.minutes)).toEqual([45, 45, 30]);
    const t = slideTotal(sheet(60, 30, [15, 15, 15]), 105);
    expect(fillRest(t).rows.map((x) => x.minutes)).toEqual([45, 30, 30]);
  });

  it("si sobra, quita de a 15 de arriba hacia abajo, sin bajar de 0", () => {
    const s = slideTotal(sheet(120, 0, [0, 60, 60]), 90);
    expect(unassigned(s)).toBe(-30);
    expect(fillRest(s).rows.map((x) => x.minutes)).toEqual([0, 45, 45]);
    const t = slideTotal(sheet(45, 0, [15, 15, 15]), 15);
    expect(fillRest(t).rows.map((x) => x.minutes)).toEqual([0, 0, 15]);
  });
});

describe("presets", () => {
  it("proporcional reparte el total como estaban los temas", () => {
    const s = slideTotal(sheet(600, 300, [480, 120]), 300);
    const r = proportional(s);
    expect(r.rows.map((x) => x.minutes)).toEqual([240, 60]);
    expect(unassigned(r)).toBe(0);
  });

  it("proporcional siempre cierra la suma, con restos de a 15", () => {
    const s = slideTotal(sheet(180, 0, [60, 60, 60]), 150);
    const r = proportional(s);
    expect(unassigned(r)).toBe(0);
    expect(r.rows.map((x) => x.minutes)).toEqual([60, 45, 45]);
  });

  it("por peso reparte según el peso y se apaga sin pesos", () => {
    const base = openSheet(
      task(600, 300, [
        unit("a", 300, { weight: 75 }),
        unit("b", 300, { weight: 25 }),
        unit("c", 0 + 30, { weight: 0 }),
      ]),
    );
    expect(hasWeights(base)).toBe(true);
    const r = byWeight(slideTotal(base, 480));
    expect(r.rows.map((x) => x.minutes)).toEqual([360, 120, 0]);
    expect(hasWeights(sheet(600, 300, [300, 300]))).toBe(false);
  });

  it("los temas hechos conservan lo suyo", () => {
    const s = openSheet(
      task(300, 60, [
        unit("d", 60, { doneAt: 1, doneByHand: true }),
        unit("a", 120),
        unit("b", 120),
      ]),
    );
    const r = proportional(slideTotal(s, 360));
    expect(r.rows.map((x) => x.minutes)).toEqual([60, 150, 150]);
  });
});

describe("temas nuevos y quitados", () => {
  it("un tema nuevo nace en 0 y alcanza hasta lo que falta asignar", () => {
    const s = addRow(slideTotal(sheet(360, 120, [180, 180]), 450), "Nuevo", "n");
    expect(s.rows.at(-1)).toMatchObject({ id: "n", minutes: 0, scale: 90 });
    expect(unassigned(s)).toBe(90);
  });

  it("sin nada que asignar alcanza una hora", () => {
    const s = addRow(sheet(360, 120, [180, 180]), "Nuevo", "n");
    expect(s.rows.at(-1)?.scale).toBe(60);
  });

  it("quitar un tema deja su tiempo sin asignar", () => {
    const s = removeRow(sheet(360, 120, [180, 180]), "u0");
    expect(s.rows).toHaveLength(1);
    expect(unassigned(s)).toBe(180);
  });
});

describe("aplicar a la tarea", () => {
  it("deja los minutos, el mínimo y los temas; el 0 es «afuera» y vuelve al subirlo", () => {
    const t = task(360, 120, [unit("a", 180, { weight: 10 }), unit("b", 180)]);
    let s = slideTotal(openSheet(t), 180);
    s = slideRow(s, "b", 0);
    const out = applySheet(t, s);
    expect(out.estimateMinutes).toBe(180);
    expect(out.minMinutes).toBe(120);
    expect(out.units[0]).toMatchObject({ id: "a", estimateMinutes: 180, weight: 10 });
    expect(out.units[1]).toMatchObject({ id: "b", estimateMinutes: 180, skipped: true });
    const back = openSheet(out);
    expect(back.rows[1]?.minutes).toBe(0);
    expect(back.rows[1]?.was).toBe(180);
    const up = applySheet(out, slideRow(slideTotal(back, 360), "b", 180));
    expect(up.units[1]?.skipped).toBeUndefined();
    expect(up.units[1]?.estimateMinutes).toBe(180);
  });

  it("agrega los temas nuevos y saca los quitados", () => {
    const t = task(360, 120, [unit("a", 180), unit("b", 180)]);
    let s = removeRow(openSheet(t), "b");
    s = addRow(s, "Práctico", "n");
    s = slideRow(s, "n", 60);
    s = slideTotal(s, 240);
    const out = applySheet(t, s);
    expect(out.units.map((u) => [u.id, u.estimateMinutes])).toEqual([
      ["a", 180],
      ["n", 60],
    ]);
    expect(out.units[1]?.title).toBe("Práctico");
    expect(out.estimateMinutes).toBe(240);
  });

  it("no toca la tarea de origen", () => {
    const t = task(360, 120, [unit("a", 180)]);
    const before = JSON.stringify(t);
    applySheet(t, slideRow(openSheet(t), "a", 60));
    expect(JSON.stringify(t)).toBe(before);
  });
});

describe("lo que dice VoiceOver", () => {
  it("«Derivadas, 1 hora 15, mínimo 1 hora»", () => {
    const s = openSheet(
      task(135, 60, [{ id: "d", title: "Derivadas", estimateMinutes: 75 }, unit("x", 60)]),
    );
    expect(rowSpoken(s, s.rows[0] as never)).toBe("Derivadas, 1 hora 15, mínimo 33 minutos");
    const t = openSheet(task(75, 75, [{ id: "d", title: "Derivadas", estimateMinutes: 75 }]));
    expect(rowSpoken(slideMin(t, 60), t.rows[0] as never)).toBe(
      "Derivadas, 1 hora 15, mínimo 1 hora",
    );
  });

  it("dice horas, minutos y cero", () => {
    expect(spoken(120)).toBe("2 horas");
    expect(spoken(45)).toBe("45 minutos");
    expect(spoken(0)).toBe("0 minutos");
    expect(spoken(60)).toBe("1 hora");
  });
});

describe("avisos de que no entra", () => {
  const NOW = zonedInstant(TIMEZONE, "2026-11-25", 10 * 60);
  const data = () => {
    const raw = pruebasData(NOW);
    return seedHistory(
      { ...raw, tasks: raw.tasks.map((t) => ({ ...t, needsReview: undefined })) },
      NOW,
    );
  };

  it("sin choques no avisa; con horas de más avisa", () => {
    const d = data();
    const t = d.tasks.find((x) => x.id === "entrega-sd");
    if (!t) throw new Error("no task");
    expect(fitOf(d, NOW, { ...t, estimateMinutes: 120, minMinutes: 60 })).toBeNull();
    // Lo que no entra aunque la tarea tenga todo el tiempo hasta la entrega.
    expect(fitOf(d, NOW, { ...t, estimateMinutes: 60 * 200, minMinutes: 60 * 200 })).toBe(
      "deadline",
    );
  }, 60_000);

  it("una tarea sin entrega por delante (hábito) no avisa", () => {
    const d = data();
    const t = d.tasks.find((x) => x.kind === "habit");
    if (!t) throw new Error("no habit");
    expect(fitOf(d, NOW, t)).toBeNull();
  }, 60_000);
});
