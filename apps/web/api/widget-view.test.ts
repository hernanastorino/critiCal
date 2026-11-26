import { describe, expect, it } from "vitest";
import { demoData } from "../src/demo.js";
import { inboxRows } from "../src/inbox.js";
import type { AppData } from "../src/model.js";
import { widgetScript } from "../src/widget-script.js";
import { widgetSilos, widgetView } from "./_lib/widget.js";

// Wednesday 2026-11-04, 10:00 in Montevideo.
const NOW = Date.UTC(2026, 10, 4, 13);
const DAY = 86_400_000;

const only = (data: AppData, ids: string[]): AppData => ({
  ...data,
  tasks: data.tasks.filter((t) => ids.includes(t.id)),
});
const withDeadline = (data: AppData, id: string, deadline: number): AppData => ({
  ...data,
  tasks: data.tasks.map((t) => (t.id === id ? { ...t, deadline } : t)),
});

describe("silos in force", () => {
  it("drops a deliverable that was due last week", () => {
    const data = withDeadline(demoData(NOW), "tp-prog", NOW - 8 * DAY);
    const titles = widgetSilos(data, NOW).map((s) => s.title);
    expect(titles).not.toContain("Entrega TP Programación");
    expect(titles).toContain("Parcial Cálculo II");
  });

  it("drops one that expired earlier this week too", () => {
    const data = withDeadline(demoData(NOW), "tp-prog", NOW - 3600_000);
    expect(widgetSilos(data, NOW).map((s) => s.title)).not.toContain("Entrega TP Programación");
  });

  it("keeps the ones with a future deadline and the weekly habits", () => {
    const titles = widgetSilos(demoData(NOW), NOW).map((s) => s.title);
    expect(titles).toEqual(
      expect.arrayContaining(["Parcial Cálculo II", "Informe Lab Física", "Gym"]),
    );
  });

  it("leaves nothing when all that is left is old", () => {
    const old = withDeadline(only(demoData(NOW), ["tp-prog"]), "tp-prog", NOW - 20 * DAY);
    expect(widgetSilos(old, NOW)).toEqual([]);
  });
});

describe("what the widget shows", () => {
  it("is the silos as tanks while there are some", () => {
    const view = widgetView(demoData(NOW), NOW);
    expect(view.mode).toBe("silos");
    expect(view.style).toBe("tanks");
    expect(view.rows.length).toBeGreaterThan(0);
    expect(view.rows[0]).toEqual(
      expect.objectContaining({ title: expect.any(String), ratio: expect.any(Number) }),
    );
  });

  it("falls back to the Bandeja, with the text of its cards, when no silo is in force", () => {
    const base = only(demoData(NOW), ["tp-prog"]);
    const data: AppData = {
      ...withDeadline(base, "tp-prog", NOW - 20 * DAY),
      proposals: [{ id: "p1", message: "Se liberó la tarde", plan: [] } as never],
    };
    const view = widgetView(data, NOW);
    expect(view.mode).toBe("inbox");
    expect(view.style).toBe("list");
    expect(view.rows).toContainEqual(
      expect.objectContaining({ title: "Se liberó la tarde", detail: "Cambios para hoy" }),
    );
    expect(view.rows.map((r) => r.title)).toEqual(inboxRows(data, NOW).map((r) => r.title));
  });

  it("lists what the Bandeja lists, in the same order, for the demo and its edges", () => {
    const edges: AppData[] = [
      demoData(NOW),
      demoData(NOW + 24 * 3_600_000),
      { ...demoData(NOW), plan: [], events: [] },
      { ...demoData(NOW), proposals: [{ id: "p1", message: "Se liberó", plan: [] } as never] },
    ];
    for (const data of edges) {
      expect(widgetView(data, NOW, []).rows.map((r) => [r.title, r.detail])).toEqual(
        inboxRows(data, NOW).map((r) => [r.title, r.detail]),
      );
    }
  });

  it("is the Bandeja, with the tab's number, when asked for it even with silos in force", () => {
    const data = demoData(NOW);
    expect(widgetSilos(data, NOW).length).toBeGreaterThan(0);
    const view = widgetView(data, NOW, [], true);
    const all = inboxRows(data, NOW);
    expect(view.mode).toBe("inbox");
    expect(view.style).toBe("list");
    expect(view.total).toBe(all.length);
    expect(view.rows.map((r) => r.title)).toEqual(all.slice(0, 7).map((r) => r.title));
  });

  it("counts everything but sends only seven short rows", () => {
    const proposals = Array.from({ length: 9 }, (_, i) => ({
      id: `p${i}`,
      message: `${"largo ".repeat(20)}${i}`,
      plan: [],
    }));
    const data = { ...demoData(NOW), proposals: proposals as never };
    const view = widgetView(data, NOW, [], true);
    expect(view.total).toBe(inboxRows(data, NOW).length);
    expect(view.total).toBeGreaterThan(7);
    expect(view.rows).toHaveLength(7);
    expect(view.rows.every((r) => r.title.length <= 41)).toBe(true);
  });

  it("says so kindly when there is nothing at all", () => {
    const data: AppData = { ...only(demoData(NOW), []), events: [], plan: [] };
    const view = widgetView(data, NOW);
    expect(view.mode).toBe("inbox");
    expect(view.rows).toEqual([]);
    expect(view.empty).toBe("Todo al día ✓");
  });
});

describe("script", () => {
  const script = widgetScript("https://critical-cal.vercel.app", "cw_x");
  it("paints what the server sends and still reads the old shape", () => {
    expect(script).toContain("body.rows");
    expect(script).toContain("body.silos.map");
    expect(script).toContain("?tab=");
  });
  it("turns into the Bandeja widget with the «bandeja» parameter, with its own saved copy", () => {
    expect(script).toContain("args.widgetParameter");
    expect(script).toContain('"bandeja"');
    expect(script).toContain("?view=inbox");
    expect(script).toContain('"Bandeja · " + total');
    expect(script).toContain("-bandeja");
    expect(script).toContain('INBOX || mode === "inbox"');
  });
  it("asks for fresh data soon and says when the data is old", () => {
    expect(script).toContain("refreshAfterDate");
    expect(script).not.toContain("15 * 60");
    expect(script).toContain("datos de hace");
    expect(script).toContain("Sin conexión");
  });
});
