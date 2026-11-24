import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Routines } from "./components/Preferences.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData } from "./demo.js";
import type { AppData, Place } from "./model.js";
import { aliasTaken } from "./places.js";
import { reducer, StoreProvider, useStore } from "./store.js";

const NOW = Date.UTC(2026, 10, 2, 20); // Monday 17:00 in Montevideo

function need<T>(x: T | null | undefined): T {
  if (x === null || x === undefined) throw new Error("missing");
  return x;
}

const seen: { store?: ReturnType<typeof useStore> } = {};
const Probe = () => {
  seen.store = useStore();
  return null;
};
const data = () => need(seen.store).data;
const start = (): AppData => reducer(demoData(NOW), { type: "refresh", now: NOW });
const gymOf = (d: AppData) => need(d.tasks.find((t) => t.title === "Gym"));

const open = () => {
  render(
    <StoreProvider initial={start} persist={false} fixedNow={NOW}>
      <ToastProvider>
        <Probe />
        <Routines />
      </ToastProvider>
    </StoreProvider>,
  );
  fireEvent.click(screen.getByLabelText(/^Gym,/));
};

beforeEach(() => {
  localStorage.clear();
});
afterEach(cleanup);

describe("30th round", () => {
  it("«Eliminar todo» de una rutina borra también su actividad, y Deshacer la devuelve", () => {
    open();
    const before = data();
    const activityId = gymOf(before).activityId;
    expect(before.activities.find((a) => a.id === activityId)?.kind).toBe("rutina");
    fireEvent.click(within(screen.getByRole("dialog", { name: "Gym" })).getByText("Eliminar…"));
    fireEvent.click(screen.getByText("Eliminar todo"));
    const gone = data();
    expect(gone.activities.some((a) => a.id === activityId)).toBe(false);
    // The count in Ajustes (activities of kind rutina) matches the list: none left behind.
    expect(
      gone.activities.filter(
        (a) => a.kind === "rutina" && !gone.tasks.some((t) => t.activityId === a.id),
      ),
    ).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    const back = data();
    expect(back.activities.find((a) => a.id === activityId)).toEqual(
      before.activities.find((a) => a.id === activityId),
    );
    expect(gymOf(back)).toEqual(gymOf(before));
  });

  it("«Eliminar de hoy en adelante» no borra la actividad (queda el historial)", () => {
    open();
    const activityId = gymOf(data()).activityId;
    fireEvent.click(within(screen.getByRole("dialog", { name: "Gym" })).getByText("Eliminar…"));
    fireEvent.click(screen.getByText("Eliminar de hoy en adelante"));
    expect(data().activities.some((a) => a.id === activityId)).toBe(true);
  });

  it("una rutina pausada no ofrece «Guardar avance»", () => {
    open();
    expect(screen.getByRole("button", { name: "Guardar avance" })).toBeTruthy();
    fireEvent.click(within(screen.getByRole("dialog", { name: "Gym" })).getByText("Desactivar…"));
    fireEvent.click(screen.getByText("Hasta que lo reactive"));
    expect(gymOf(data()).paused).toBe(true);
    fireEvent.click(screen.getByLabelText(/^Gym,/));
    const sheet = screen.getByRole("dialog", { name: "Gym" });
    expect(within(sheet).queryByRole("button", { name: "Guardar avance" })).toBeNull();
    expect(within(sheet).getByText("Reactivar")).toBeTruthy();
  });
});

describe("alias repetido entre lugares", () => {
  const facu: Place = { id: "facu", name: "Facultad", aliases: ["FING"] };
  const gym: Place = { id: "gym", name: "Gym", aliases: [] };
  it("avisa sin mayúsculas, espacios ni invisibles, contra nombres y alias de otros lugares", () => {
    const places = [facu, gym];
    expect(aliasTaken(places, "fing", "gym")).toBe("fing");
    expect(aliasTaken(places, "Sport,  F​ING ", "gym")).toBe("F​ING");
    expect(aliasTaken(places, "facultad", "gym")).toBe("facultad");
    expect(aliasTaken(places, "Sport, Pesas", "gym")).toBeUndefined();
    // Its own aliases are not a clash.
    expect(aliasTaken(places, "fing", "facu")).toBeUndefined();
  });
});
