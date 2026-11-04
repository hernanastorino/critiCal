import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Inbox } from "./components/Inbox.js";
import { Places } from "./components/Places.js";
import { emptyData } from "./demo.js";
import { MINUTE, zonedInstant } from "./engine.js";
import type { AppData, AppEvent, Place } from "./model.js";
import { home, minutesBetween, placeFor, travelOptions, unlocated, withPlaces } from "./places.js";
import { scheduleInput } from "./planning.js";
import { reducer, StoreProvider, useStore } from "./store.js";

afterEach(cleanup);

const tz = "America/Montevideo";
const NOW = zonedInstant(tz, "2026-11-04", 8 * 60);
const casa: Place = { id: "casa", name: "Casa", aliases: [], isHome: true };
const facu: Place = { id: "facu", name: "Facultad de Ingeniería", aliases: ["FING"] };
const gym: Place = { id: "gym", name: "Gym", aliases: ["Gimnasio Sport"] };

const event = (id: string, title: string, hour: number, location?: string): AppEvent => ({
  id,
  title,
  start: zonedInstant(tz, "2026-11-04", hour * 60),
  end: zonedInstant(tz, "2026-11-04", hour * 60 + 90),
  busy: true,
  location,
  source: "google",
});

function data(extra: Partial<AppData> = {}): AppData {
  return {
    ...emptyData(),
    places: [casa, facu, gym],
    travelTimes: [
      { from: "casa", to: "facu", minutes: 25, manual: false },
      { from: "casa", to: "facu", minutes: 30, manual: true },
      { from: "facu", to: "casa", minutes: 20, manual: false },
    ],
    ...extra,
  };
}

describe("places", () => {
  it("matches locations by name or alias, the longest first", () => {
    const places = [casa, facu, gym, { id: "f2", name: "Facultad", aliases: [] }];
    expect(placeFor(places, "Aula 301, FING")?.id).toBe("facu");
    expect(placeFor(places, "facultad de ingenieria (salón 5)")?.id).toBe("facu");
    expect(placeFor(places, "Facultad de Química")?.id).toBe("f2");
    expect(placeFor(places, "Gimnasio Sport Centro")?.id).toBe("gym");
    expect(placeFor(places, "Shopping")).toBeUndefined();
    expect(placeFor(places, undefined)).toBeUndefined();
  });

  it("prefers manual driving times", () => {
    expect(minutesBetween(data(), "casa", "facu")).toBe(30);
    expect(minutesBetween(data(), "facu", "casa")).toBe(20);
    expect(minutesBetween(data(), "casa", "gym")).toBeUndefined();
    expect(home(data())?.id).toBe("casa");
  });

  it("locates events by title and skips the ones marked as no trip", () => {
    const d = data({ noTravel: ["clase online"] });
    const [byTitle, located, online, unknown] = withPlaces(d, [
      event("a", "Gym", 18),
      event("b", "Parcial", 9, "FING"),
      event("c", "Teórico", 11, "Clase online"),
      event("d", "Cumple", 20),
    ]);
    expect(byTitle?.location).toBe("Gym");
    expect(located?.location).toBe("FING");
    expect(online?.location).toBeUndefined();
    expect(unknown?.location).toBeUndefined();
    expect(
      withPlaces({ ...d, places: [facu] }, [event("a", "Gym", 18)])[0]?.location,
    ).toBeUndefined();
  });

  it("reserves the drive to and from an event in the plan", () => {
    const d = data({ events: [event("b", "Clase", 10, "FING")] });
    const input = scheduleInput(d, NOW, []);
    const opts = travelOptions(d);
    expect(opts?.home).toBe("casa");
    expect(opts?.marginMinutes).toBe(d.settings.travelMarginMinutes);
    expect(input.travel?.resolvePlace("FING")).toBe("facu");
    expect(input.travel?.travelMinutes("casa", "facu")).toBe(30);
    expect(travelOptions({ ...d, places: [facu] })).toBeUndefined();
  });

  it("asks once per unknown place, only for upcoming busy events", () => {
    const d = data();
    const asked = unlocated(
      d,
      [
        event("1", "Inglés", 9, "Instituto Anglo"),
        {
          ...event("2", "Inglés", 9, "Instituto Anglo"),
          id: "2",
          start: NOW + 86_400_000,
          end: NOW + 86_400_000 + 3_600_000,
        },
        event("3", "Juntada", 21),
        event("4", "Clase", 10, "FING"),
        { ...event("5", "Feriado", 0), allDay: true },
        { ...event("6", "Libre", 15), busy: false },
        { ...event("7", "Pasado", 6), end: NOW - MINUTE },
      ],
      NOW,
    );
    expect(asked.map((a) => a.text)).toEqual(["Instituto Anglo", "Juntada"]);
    expect(unlocated({ ...d, places: [] }, [event("1", "X", 9, "Y")], NOW)).toEqual([]);
  });

  it("learns an event's place, or that it needs no trip", () => {
    let d = reducer(data(), { type: "locate", text: "Instituto Anglo", placeId: "facu", now: NOW });
    expect(d.places?.find((p) => p.id === "facu")?.aliases).toEqual(["FING", "Instituto Anglo"]);
    d = reducer(d, { type: "locate", text: "Juntada en lo de Juan", placeId: null, now: NOW });
    expect(d.noTravel).toEqual(["juntada en lo de juan"]);
  });

  it("keeps one home, and forgets a deleted place's times", () => {
    let d = reducer(data(), { type: "savePlace", place: { ...gym, isHome: true }, now: NOW });
    expect(d.places?.filter((p) => p.isHome).map((p) => p.id)).toEqual(["gym"]);
    d = reducer(d, { type: "travelTime", from: "gym", to: "facu", minutes: 12, now: NOW });
    expect(minutesBetween(d, "gym", "facu")).toBe(12);
    d = reducer(d, { type: "deletePlace", placeId: "facu", now: NOW });
    expect(d.travelTimes?.some((t) => t.from === "facu" || t.to === "facu")).toBe(false);
  });
});

function Probe() {
  const { data } = useStore();
  return <output data-testid="places">{JSON.stringify(data.places)}</output>;
}

describe("places screens", () => {
  it("adds a place and edits a driving time", async () => {
    render(
      <StoreProvider initial={() => data()} persist={false} fixedNow={NOW}>
        <Places />
        <Probe />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByText("Agregar lugar"));
    fireEvent.change(screen.getByPlaceholderText("Facu"), { target: { value: "Trabajo" } });
    fireEvent.change(screen.getByPlaceholderText("FING, Facultad"), {
      target: { value: "Oficina, WeWork" },
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Guardar"));
    });
    const saved = JSON.parse(screen.getByTestId("places").textContent ?? "[]") as Place[];
    expect(saved.at(-1)).toMatchObject({ name: "Trabajo", aliases: ["Oficina", "WeWork"] });

    const input = screen.getByLabelText("Minutos de Casa a Gym") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "15" } });
    await act(async () => {
      fireEvent.blur(input);
    });
    expect((screen.getByLabelText("Minutos de Casa a Gym") as HTMLInputElement).value).toBe("15");
  });

  it("asks where an event is from the inbox", async () => {
    render(
      <StoreProvider
        initial={() => data({ events: [event("x", "Inglés", 10, "Instituto Anglo")] })}
        persist={false}
        fixedNow={NOW}
      >
        <Inbox />
        <Probe />
      </StoreProvider>,
    );
    expect(screen.getByText("¿Dónde es?")).toBeTruthy();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Lugar de Inglés"), { target: { value: "facu" } });
    });
    expect(screen.queryByText("¿Dónde es?")).toBeNull();
    expect(screen.getByTestId("places").textContent).toContain("Instituto Anglo");
  });
});
