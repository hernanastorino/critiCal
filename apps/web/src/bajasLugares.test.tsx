import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Inbox } from "./components/Inbox.js";
import { demoData, emptyData, TIMEZONE } from "./demo.js";
import { zonedInstant } from "./engine.js";
import type { AppData } from "./model.js";
import { nameTaken, placeFor, spotKey } from "./places.js";
import { reducer, StoreProvider } from "./store.js";

const NOW = zonedInstant(TIMEZONE, "2026-11-03", 8 * 60);

describe("cambiar los minutos de un traslado", () => {
  it("no inventa «Un evento nuevo pisa…»", () => {
    const base = demoData(NOW);
    const ev = {
      id: "ev1",
      title: "Inglés",
      start: zonedInstant(TIMEZONE, "2026-11-03", 18 * 60),
      end: zonedInstant(TIMEZONE, "2026-11-03", 19 * 60),
      busy: true,
      location: "Instituto Anglo",
      source: "google" as const,
    };
    let d: AppData = reducer(
      { ...base, events: [ev], preferences: { holidaysOff: false } },
      { type: "refresh", now: NOW },
    );
    d = reducer(d, { type: "spotMinutes", text: "Instituto Anglo", minutes: 10, now: NOW });
    for (const m of [60, 240, 5, 0, 600]) {
      d = reducer(d, { type: "spotMinutes", text: "Instituto Anglo", minutes: m, now: NOW });
      expect(
        d.proposals.map((p) => p.message),
        `minutos ${m}`,
      ).toEqual([]);
    }
  });
});

describe("los lugares: lo que se anotó como Baja y ya no pasa", () => {
  const casa = { id: "casa", name: "Casa", aliases: [], isHome: true, address: "Rivera 1234" };
  const event = (location?: string) => ({
    id: "x",
    title: "Inglés",
    start: zonedInstant(TIMEZONE, "2026-11-03", 18 * 60),
    end: zonedInstant(TIMEZONE, "2026-11-03", 19 * 60),
    busy: true,
    location,
    source: "google" as const,
  });
  const inbox = (location: string) => (
    <StoreProvider
      initial={() => ({ ...emptyData(), places: [casa], events: [event(location)] })}
      persist
      fixedNow={NOW}
    >
      <Inbox />
    </StoreProvider>
  );
  afterEach(cleanup);

  it("spotKey no borra los emojis: «🏠🎉 de 👵» y «💼 de 🏢» son lugares distintos", () => {
    expect(spotKey("🏠🎉 de 👵")).not.toBe(spotKey("💼 de 🏢"));
    expect(spotKey("Gimnasio")).toBe(spotKey("gimnasio "));
  });

  it("la dirección exacta de casa se reconoce en minúsculas y con otra forma", () => {
    expect(placeFor([casa], "rivera 1234")?.id).toBe("casa");
    expect(placeFor([casa], "RIVERA  1234")?.id).toBe("casa");
  });

  it("no deja guardar un lugar con nombre repetido", () => {
    expect(nameTaken([casa], "  CASA ")).toBe(true);
    expect(nameTaken([casa], "Casa de Clara")).toBe(false);
  });

  it("Enter confirma los minutos y el nombre; «abc» se marca y avisa", () => {
    localStorage.clear();
    render(inbox("Instituto Anglo"));
    const field = screen.getByLabelText("O minutos desde casa para Inglés");
    fireEvent.change(field, { target: { value: "abc" } });
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toMatch(/solo cifras/);
    fireEvent.change(field, { target: { value: "15" } });
    expect(field.getAttribute("aria-invalid")).toBeNull();
    // Ticking «Guardar como lugar» goes to the name, and Enter there confirms.
    fireEvent.click(screen.getByLabelText("Guardar como lugar"));
    const name = screen.getByLabelText("Nombre del lugar");
    expect(document.activeElement).toBe(name);
    fireEvent.change(name, { target: { value: "casa" } });
    expect(name.getAttribute("aria-invalid")).toBe("true");
    fireEvent.keyDown(name, { key: "Enter" });
    expect(screen.getByLabelText("O minutos desde casa para Inglés")).toBeTruthy();
    fireEvent.change(name, { target: { value: "Instituto" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(screen.queryByLabelText("O minutos desde casa para Inglés")).toBeNull();
  });

  it("una dirección larguísima no se muestra entera", () => {
    localStorage.clear();
    render(inbox(`Calle ${"muy larga ".repeat(40)}`));
    const meta = [...document.querySelectorAll(".meta")].find((p) =>
      p.textContent?.includes("Calle"),
    );
    expect((meta?.textContent ?? "").length).toBeLessThan(200);
  });
});
