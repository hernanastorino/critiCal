import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { ToastProvider, useToast } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { zonedInstant } from "./engine.js";
import type { AppEvent } from "./model.js";
import { mealTimes } from "./planning.js";
import { reducer } from "./store.js";

const at = (date: string, minutes: number) => zonedInstant(TIMEZONE, date, minutes);
const NOW = at("2026-11-02", 8 * 60);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(() => {
  cleanup();
  document.documentElement.style.fontSize = "";
});

const css = readFileSync(resolve(__dirname, "styles.css"), "utf8");
const rule = (selector: string) =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("}")
    .find((b) => b.split("{")[0]?.trim() === selector)
    ?.split("{")[1] ?? "";

describe("a block's ring when its bubble closes", () => {
  const pill = () => screen.getByTestId("week").querySelector<HTMLElement>(".pill.planned");

  it.each([
    ["the backdrop", () => fireEvent.click(document.querySelector(".scrim") as Element)],
    ["Escape", () => fireEvent.keyDown(document, { key: "Escape" })],
  ])("goes at once when it is closed with %s", (_, close) => {
    render(<App fixedNow={NOW} initial={() => demoData(NOW)} />);
    const p = pill();
    if (!p) throw new Error("no block");
    fireEvent.click(p);
    expect(p.className).toContain("selected");
    act(() => close());
    expect(p.className).not.toContain("selected");
    // And the ring does not fade out afterwards: only the selected state animates it.
    expect(rule(".pill:not(.selected)")).not.toMatch(/box-shadow/);
  });
});

describe("the sheets' spring", () => {
  it("overshoots upwards without leaving a gap under the sheet", () => {
    expect(rule(".sheet")).toMatch(/animation:\s*up 0\.3s var\(--spring\)/);
    expect(rule(".sheet")).toMatch(/box-shadow:\s*0 \d+px 0 0 var\(--surface\)/);
  });
});

function Shows({ message, tone }: { message: string; tone?: "alert" }) {
  const toast = useToast();
  useEffect(() => {
    toast.setPinned(<div className="snack">Resumen crítico</div>);
    toast.show(message, { tone });
  }, [toast.show, toast.setPinned, message, tone]);
  return null;
}
const mount = (message: string, tone?: "alert") =>
  render(
    <ToastProvider>
      <Shows message={message} tone={tone} />
    </ToastProvider>,
  );

describe("notices and the standing summary", () => {
  it("stack in one column with large text: the notice over the summary", () => {
    document.documentElement.style.fontSize = "32px";
    mount("Movido a las 10:00");
    const stack = document.querySelector(".snacks.stacked");
    expect(stack).not.toBeNull();
    const [first, second] = Array.from(stack?.children ?? []);
    expect(first?.className).toBe("toasts low");
    expect(first?.textContent).toBe("Movido a las 10:00");
    expect(second?.textContent).toBe("Resumen crítico");
    // No fixed position of its own: it cannot sit on top of the summary.
    expect(rule(".toasts.low")).toMatch(/position:\s*static/);
  });

  it("keep their usual places with the usual text size", () => {
    document.documentElement.style.fontSize = "17px";
    mount("Listo");
    expect(document.querySelector(".snacks.stacked")).toBeNull();
    expect(document.querySelector(".snacks")?.textContent).toBe("Resumen crítico");
    expect(document.querySelector(".toasts")?.className).toBe("toasts");
  });

  it.each([
    ["a refused move", "Ahí no entra: choca con «Clase»."],
    ["a correction", "Corregido: «Parcial» pasó a 10:00."],
  ])("%s never goes to the top with large text (it would cover the week's bar)", (_, message) => {
    document.documentElement.style.fontSize = "32px";
    mount(message, "alert");
    const box = document.querySelector(".toasts");
    expect(box?.className).toBe("toasts low");
    expect(box?.textContent).toBe(message);
    expect(rule(".toasts")).toMatch(/top:/);
    expect(rule(".toasts.low")).not.toMatch(/top:/);
  });
});

describe("«Reacomodar hoy» with a late wake-up over an unanswered event", () => {
  it("moves breakfast to just after the event: no tiny block squeezed against it", () => {
    const d0 = demoData(NOW);
    const event: AppEvent = {
      id: "reu",
      title: "Reunión?",
      start: at("2026-11-02", 10 * 60),
      end: at("2026-11-02", 12 * 60),
      busy: true,
      tentative: true,
      source: "demo",
    };
    let d = reducer(
      { ...d0, events: [...d0.events, event], preferences: { holidaysOff: false } },
      { type: "refresh", now: NOW },
    );
    d = reducer(d, {
      type: "override",
      override: { date: "2026-11-02", wake: 11 * 60, bed: 23 * 60 },
      now: NOW,
    } as never);
    const meals = mealTimes(d, NOW, at("2026-11-02", 0), at("2026-11-03", 0));
    const breakfast = meals.find((m) => m.kind === "desayuno")?.at;
    // It does not overlap the event: it goes right after it, as a block of its own.
    expect(breakfast?.start).toBe(event.end);
    expect(breakfast && breakfast.end - breakfast.start).toBe(30 * 60_000);
    // The plan leaves that stretch free too.
    expect(d.plan.some((b) => b.start < event.end && b.end > event.start)).toBe(false);
  });
});
