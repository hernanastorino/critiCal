import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorOf, NOW, roundTrip } from "./atacante11Kit.js";
import { importFromCalendars } from "./calendars.js";
import { Inbox } from "./components/Inbox.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData } from "./demo.js";
import type { Activity } from "./engine.js";
import { reducer, StoreProvider } from "./store.js";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("12.ª vuelta: materia con estudio semanal enorme pasada a rutina", () => {
  it("se exporta y se vuelve a importar igual", () => {
    const study = reducer(demoData(NOW), {
      type: "weeklyStudy",
      activityId: "calc",
      minutes: 100 * 60,
      now: NOW,
    });
    const sorted = reducer(study, {
      type: "sortActivity",
      activityId: "calc",
      as: "rutina",
      now: NOW,
    });
    expect(errorOf(roundTrip(sorted))).toBe("");
  });
});

describe("12.ª vuelta: Bandeja, foco después de «Deshacer» de «Ordenar tus actividades»", () => {
  it("vuelve a la tarjeta que volvió, no al título", () => {
    const base = demoData(NOW);
    const old: Activity = {
      ...(base.activities[0] as Activity),
      id: "gym",
      name: "gym",
      kind: undefined,
      aliases: [],
    };
    const d = {
      ...base,
      activities: [...base.activities, old],
      calendars: [
        {
          id: "icloud:work",
          source: "icloud" as const,
          externalId: "work",
          name: "Work",
          role: "clases" as const,
        },
      ],
    };
    render(
      <StoreProvider initial={() => d} persist={false} fixedNow={NOW}>
        <ToastProvider>
          <Inbox />
        </ToastProvider>
      </StoreProvider>,
    );
    const card = () => document.querySelector<HTMLElement>('[data-block-id="gym"]');
    expect(card()).not.toBeNull();
    const rutina = [...(card()?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "Rutina",
    ) as HTMLElement;
    fireEvent.click(rutina);
    expect(card()).toBeNull();
    const undo = screen.getByRole("button", { name: "Deshacer" });
    undo.focus();
    act(() => {
      fireEvent.click(undo);
    });
    expect(document.activeElement?.closest("[data-block-id]")).toBe(card());
  });
});

describe("12.ª vuelta: lo creado desde el calendario se reimporta", () => {
  const MS = 86_400_000;
  const withEvent = (title: string, start: number) => {
    const base = demoData(NOW);
    const d = {
      ...base,
      calendars: [
        {
          id: "icloud:parciales",
          source: "icloud" as const,
          externalId: "parciales",
          name: "Parciales",
        },
      ],
      events: [
        ...base.events,
        {
          id: "icloud:largo",
          title,
          start,
          end: start + 2 * 3_600_000,
          busy: true,
          source: "icloud" as const,
          calendarId: "icloud:parciales",
        },
      ],
    };
    return importFromCalendars(d, NOW, () => "id-nuevo");
  };

  it("un título de más de 300 letras", () => {
    const d = withEvent(`Parcial ${"X".repeat(400)}`, NOW + 20 * MS);
    expect(d.tasks.some((t) => t.sourceEventId === "icloud:largo")).toBe(true);
    expect(errorOf(roundTrip(d))).toBe("");
  });

  it("una fecha a más de 5 años", () => {
    const d = withEvent("Parcial lejano", NOW + 8 * 365 * MS);
    expect(errorOf(roundTrip(d))).toBe("");
  });
});
