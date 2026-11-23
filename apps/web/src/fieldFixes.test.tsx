import { existsSync, readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Inbox } from "./components/Inbox.js";
import { ActivitySettings, WeekSettings } from "./components/Preferences.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData } from "./demo.js";
import { clearDrafts } from "./drafts.js";
import { zonedInstant } from "./engine.js";
import { reducer, StoreProvider } from "./store.js";
import { tapDone } from "./testDone.js";

afterEach(() => {
  cleanup();
  clearDrafts();
  vi.unstubAllGlobals();
});

const NOW = zonedInstant("America/Montevideo", "2026-11-04", 8 * 60);

const subjects = () =>
  render(
    <StoreProvider initial={() => demoData(NOW)} persist={false} fixedNow={NOW}>
      <ToastProvider>
        <ActivitySettings />
      </ToastProvider>
    </StoreProvider>,
  );

describe("Materias form", () => {
  it("shows the «Prefiero desde / hasta» error right under those fields, marked invalid", () => {
    subjects();
    fireEvent.click(document.querySelector(".activity-head") as HTMLElement);
    fireEvent.change(screen.getByLabelText("Prefiero desde"), { target: { value: "18:00" } });
    fireEvent.change(screen.getByLabelText("hasta"), { target: { value: "09:00" } });
    const error = screen.getByText("«Prefiero desde» tiene que ser antes de «hasta».");
    const save = screen.getByText(/^Guardar/);
    expect(error.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const label of ["Prefiero desde", "hasta"]) {
      const input = screen.getByLabelText(label);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(input.getAttribute("aria-describedby")).toBe(error.id);
    }
    expect(save.getAttribute("aria-disabled")).toBe("true");
  });

  it("hides the ▼/▲ glyph from screen readers", () => {
    subjects();
    const head = document.querySelector(".activity-head") as HTMLElement;
    expect(head.querySelector('[aria-hidden="true"]')?.textContent).toBe("▼");
    fireEvent.click(head);
    expect(head.querySelector('[aria-hidden="true"]')?.textContent).toBe("▲");
  });

  it("names the saved materia in both Guardar and Eliminar while its name is edited", () => {
    subjects();
    fireEvent.click(screen.getByText("Física I"));
    fireEvent.change(screen.getByLabelText("Nombre de la materia"), {
      target: { value: "Otro nombre" },
    });
    expect(screen.getByText("Guardar Física I")).toBeTruthy();
    expect(screen.getByText("Eliminar Física I")).toBeTruthy();
  });

  it("drops the name from the buttons when it is long", () => {
    const long = { ...demoData(NOW) };
    long.activities = long.activities.map((a, i) =>
      i === 0 ? { ...a, name: "Un nombre larguísimo de materia" } : a,
    );
    render(
      <StoreProvider initial={() => long} persist={false} fixedNow={NOW}>
        <ToastProvider>
          <ActivitySettings />
        </ToastProvider>
      </StoreProvider>,
    );
    fireEvent.click(document.querySelector(".activity-head") as HTMLElement);
    expect(screen.getByText("Guardar")).toBeTruthy();
    expect(screen.getByText("Eliminar")).toBeTruthy();
  });

  it("keeps focus on a neighbour row after deleting, and on the note when none is left", () => {
    subjects();
    const heads = () => [...document.querySelectorAll<HTMLElement>(".activity-head")];
    const total = heads().length;
    expect(total).toBeGreaterThan(1);
    for (let left = total; left > 0; left--) {
      fireEvent.click(heads()[0] as HTMLElement);
      fireEvent.click(screen.getByText(/^Eliminar/));
      expect(document.activeElement).not.toBe(document.body);
      if (left > 1) expect(document.activeElement?.classList.contains("activity-head")).toBe(true);
    }
    expect(document.activeElement?.id).toBe("subjects-empty");
  });
});

describe("Mi semana", () => {
  it("clears the error once the form no longer has the problem, whatever fixed it", () => {
    render(
      <StoreProvider initial={() => demoData(NOW)} persist={false} fixedNow={NOW}>
        <ToastProvider>
          <WeekSettings />
        </ToastProvider>
      </StoreProvider>,
    );
    // Breakfast while asleep: getting up at 23:00.
    fireEvent.change(screen.getByLabelText("Me levanto"), { target: { value: "23:00" } });
    fireEvent.click(screen.getByText(/^Guardar para/));
    expect(screen.getByRole("alert").textContent).toMatch(/cae, o termina, cuando estás dormido/);
    // Changing days keeps what was typed (it is still a problem), so the error stays…
    fireEvent.click(screen.getByLabelText("sábado"));
    expect(screen.getByRole("alert").textContent).toMatch(/cuando estás dormido/);
    // …and it goes as soon as the form no longer has it.
    fireEvent.change(screen.getByLabelText("Me levanto"), { target: { value: "07:00" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Bandeja focus", () => {
  it("moves focus to the next card when a block is resolved", () => {
    const base = reducer(demoData(NOW), { type: "refresh", now: NOW });
    const plan = [...base.plan].sort((a, b) => a.start - b.start);
    const later = (plan[1] as (typeof plan)[number]).end + 1;
    render(
      <StoreProvider initial={() => base} persist={false} fixedNow={later}>
        <ToastProvider>
          <Inbox />
        </ToastProvider>
      </StoreProvider>,
    );
    const done = screen.getAllByLabelText(/^Hecho:/);
    expect(done.length).toBeGreaterThan(1);
    (done[0] as HTMLElement).focus();
    tapDone(done[0] as HTMLElement);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.querySelector(".scroll")?.contains(document.activeElement)).toBe(true);
  });

  it("falls back to the screen title when the last card goes", () => {
    const base = reducer(demoData(NOW), { type: "refresh", now: NOW });
    const first = [...base.plan].sort((a, b) => a.start - b.start)[0] as (typeof base.plan)[number];
    render(
      <StoreProvider initial={() => base} persist={false} fixedNow={first.end + 1}>
        <ToastProvider>
          <Inbox />
        </ToastProvider>
      </StoreProvider>,
    );
    const done = screen.getAllByLabelText(/^Hecho:/);
    (done[0] as HTMLElement).focus();
    for (let i = done.length; i > 0; i--) {
      tapDone(screen.getAllByLabelText(/^Hecho:/)[0] as HTMLElement);
      expect(document.activeElement).not.toBe(document.body);
    }
  });
});

describe("touch targets (SPEC §14)", () => {
  // Run from the repo root or from apps/web.
  const file = ["apps/web/src/styles.css", "src/styles.css"].find((f) => existsSync(f)) as string;
  const css = readFileSync(file, "utf8");
  const reach = (selector: string) => {
    // The ::before that grows the tappable area, as a rule block.
    const rule = css.split("}").find((block) =>
      block
        .split("{")[0]
        ?.split(",")
        .some((s) => s.trim() === `${selector}::before`),
    );
    return rule?.split("{")[1] ?? "";
  };
  it.each([".btn.small", ".chip", ".swatch.big", ".check > button", ".sheet-close"])(
    "%s has an invisible 44 px hit area",
    (selector) => {
      const rule = reach(selector);
      expect(rule).toMatch(/width:\s*max\(100%,\s*44px\)/);
      expect(rule).toMatch(/height:\s*max\(100%,\s*44px\)/);
    },
  );
  it("makes label rows 44 px tall without moving them", () => {
    // 22 px box + 2 × 11 px padding = 44; the -3 px margin gives back the old 38 px.
    expect(css).toMatch(/label\.check\s*{\s*padding:\s*11px 0;\s*margin:\s*-3px 0;/);
  });
});
