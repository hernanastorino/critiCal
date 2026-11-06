import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Inbox } from "./components/Inbox.js";
import { Places } from "./components/Places.js";
import { applyWrites, diffData } from "./data.js";
import { emptyData } from "./demo.js";
import { MINUTE, zonedInstant } from "./engine.js";
import type { AppData, AppEvent, Place } from "./model.js";
import {
  home,
  minutesBetween,
  placeFor,
  searchPlaces,
  travelOptions,
  unlocated,
  withPlaces,
} from "./places.js";
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

describe("event addresses and search", () => {
  const clara = { id: "c1", name: "Casa de Clara", aliases: [], address: "Rivera 1234" };
  const trabajo = { id: "c2", name: "Trabajo de Clara", aliases: ["Oficina"] };
  const cancha = { id: "c3", name: "Canchas del Parque", aliases: [] };

  it("suggests every place that matches, by name, alias, address or event", () => {
    const d = data({
      places: [casa, facu, clara, trabajo, cancha],
      events: [
        event("f1", "Fútbol 5", 18, "Canchas del Parque"),
        event("f2", "Fútbol 5", 19, "Canchas del Parque"),
      ],
    });
    expect(searchPlaces(d, "clara").map((p) => p.id)).toEqual(["c1", "c2"]);
    expect(searchPlaces(d, "ofi").map((p) => p.id)).toEqual(["c2"]);
    expect(searchPlaces(d, "rivera").map((p) => p.id)).toEqual(["c1"]);
    // Not in its name: found through the events held there.
    expect(searchPlaces(d, "futbol").map((p) => p.id)).toEqual(["c3"]);
    expect(searchPlaces(d, "casa clara").map((p) => p.id)).toEqual(["c1"]);
    expect(searchPlaces(d, "  ")).toEqual([]);
    // An event with a blank address is held at the place its title names.
    const yoga = { ...d, events: [{ ...event("y", "Yoga Gym", 9), location: " " }], places: [gym] };
    expect(searchPlaces(yoga, "yoga").map((p) => p.id)).toEqual(["gym"]);
  });

  it("plans the trip to a timed address without it being a place", () => {
    const d = data({
      events: [event("x", "Inglés", 10, "Instituto Anglo"), event("y", "Fútbol", 18)],
      spots: [
        { key: "instituto anglo", text: "Instituto Anglo", minutes: 15 },
        { key: "futbol", text: "Fútbol", minutes: 20, manual: true },
      ],
    });
    const opts = travelOptions(d);
    const anglo = opts?.resolvePlace("Instituto Anglo") as string;
    expect(anglo).toBe("spot:instituto anglo");
    expect(opts?.travelMinutes("casa", anglo)).toBe(15);
    expect(opts?.travelMinutes(anglo, "facu")).toBe(15);
    // An event without an address takes the minutes typed under its title.
    expect(withPlaces(d, d.events).find((e) => e.id === "y")?.location).toBe("Fútbol");
    expect(unlocated(d, d.events, NOW)).toEqual([]);
    // Not timed yet: asked about, or looked up first when there is an address.
    const fresh = unlocated({ ...d, spots: [] }, d.events, NOW);
    expect(fresh.map((u) => [u.text, u.lookup])).toEqual([
      ["Instituto Anglo", true],
      ["Fútbol", false],
    ]);
    const failed = {
      ...d,
      spots: [{ key: "instituto anglo", text: "Instituto Anglo", failed: true }],
    };
    expect(unlocated(failed, d.events, NOW).find((u) => u.key === "instituto anglo")?.lookup).toBe(
      false,
    );
  });

  it("keeps typed minutes, saves a spot as a place and forgets stale times", () => {
    let d = data({ events: [event("x", "Inglés", 10, "Instituto Anglo")] });
    d = reducer(d, { type: "spotMinutes", text: "Instituto Anglo", minutes: 12, now: NOW });
    d = reducer(d, {
      type: "spots",
      results: [
        { text: "Instituto Anglo", minutes: 40 },
        { text: "Lejos 1", minutes: null },
      ],
      now: NOW,
    });
    expect(d.spots).toEqual([
      { key: "instituto anglo", text: "Instituto Anglo", minutes: 12, manual: true },
      { key: "lejos 1", text: "Lejos 1", failed: true },
    ]);
    // Answering with a saved place drops the failed lookup.
    d = reducer(d, { type: "locate", text: "Lejos 1", placeId: "gym", now: NOW });
    expect(d.spots?.map((s) => s.key)).toEqual(["instituto anglo"]);

    const saved = reducer(d, {
      type: "saveSpot",
      key: "instituto anglo",
      name: " Anglo ",
      now: NOW,
    });
    const anglo = saved.places?.find((p) => p.name === "Anglo");
    expect(anglo).toMatchObject({ aliases: ["Instituto Anglo"], address: "Instituto Anglo" });
    expect(minutesBetween(saved, "casa", anglo?.id as string)).toBe(12);
    expect(minutesBetween(saved, anglo?.id as string, "casa")).toBe(12);
    expect(saved.spots).toEqual([]);
    expect(reducer(d, { type: "saveSpot", key: "instituto anglo", name: " ", now: NOW })).toBe(d);

    // A new home address makes computed spots stale; typed ones stay.
    const both = reducer(d, {
      type: "spots",
      results: [{ text: "Otro", minutes: 9 }],
      now: NOW,
    });
    const moved = reducer(both, {
      type: "savePlace",
      place: { ...casa, address: "Nueva 1" },
      now: NOW,
    });
    expect(moved.spots?.map((s) => s.key)).toEqual(["instituto anglo"]);
    expect(reducer(moved, { type: "forgetSpot", key: "instituto anglo", now: NOW }).spots).toEqual(
      [],
    );
    // So does unchecking «Es mi casa».
    expect(
      reducer(both, {
        type: "savePlace",
        place: { ...casa, isHome: undefined },
        now: NOW,
      }).spots?.map((s) => s.key),
    ).toEqual(["instituto anglo"]);
    expect(reducer(both, { type: "savePlace", place: { ...gym }, now: NOW }).spots).toHaveLength(2);
    // Deleting the home has the same effect.
    expect(
      reducer(both, { type: "deletePlace", placeId: "casa", now: NOW }).spots?.map((s) => s.key),
    ).toEqual(["instituto anglo"]);
    expect(reducer(both, { type: "deletePlace", placeId: "gym", now: NOW }).spots).toHaveLength(2);
  });

  it("treats an address of blanks as none, in the inbox and in the plan", () => {
    const blank = { ...event("b", "Fútbol", 18), location: "   " };
    let d = data({ events: [blank] });
    expect(unlocated(d, d.events, NOW).map((u) => [u.text, u.lookup])).toEqual([["Fútbol", false]]);
    d = reducer(d, { type: "spotMinutes", text: "Fútbol", minutes: 20, now: NOW });
    expect(unlocated(d, d.events, NOW)).toEqual([]);
    expect(withPlaces(d, d.events)[0]?.location).toBe("Fútbol");
    // A saved place named in the title answers it too.
    const gymTitle = data({ events: [{ ...event("g", "Gym", 18), location: " " }] });
    expect(unlocated(gymTitle, gymTitle.events, NOW)).toEqual([]);
    expect(withPlaces(gymTitle, gymTitle.events)[0]?.location).toBe("Gym");
  });

  it("tells apart addresses without Latin letters and keeps minutes in range", () => {
    let d = data();
    d = reducer(d, { type: "spotMinutes", text: "東京駅", minutes: 30.4, now: NOW });
    d = reducer(d, { type: "spotMinutes", text: "Москва", minutes: 5000, now: NOW });
    expect(d.spots).toEqual([
      { key: "東京駅", text: "東京駅", minutes: 30, manual: true },
      { key: "москва", text: "Москва", minutes: 1440, manual: true },
    ]);
    expect(reducer(d, { type: "spotMinutes", text: "x", minutes: -1, now: NOW })).toBe(d);
    expect(reducer(d, { type: "spotMinutes", text: "x", minutes: Number.NaN, now: NOW })).toBe(d);
  });

  it("stores spots with the settings", () => {
    const before = data();
    const after = { ...before, spots: [{ key: "a", text: "A", minutes: 5 }] };
    const writes = diffData(before, after);
    const settings = writes.upserts.find((u) => u.table === "settings");
    expect(settings?.rows[0]).toMatchObject({ state: { spots: after.spots } });
  });
});

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

  it("drops computed times of a place whose address changed, and writes the deletion", async () => {
    const before = data();
    const moved = reducer(before, {
      type: "savePlace",
      place: { ...facu, address: "Otra dirección 123" },
      now: NOW,
    });
    expect(moved.travelTimes).toEqual([{ from: "casa", to: "facu", minutes: 30, manual: true }]);
    const w = diffData(before, moved);
    expect(w.deletes).toContainEqual({ table: "travel_times", ids: ["facu>casa>computed"] });
    const deleted: unknown[][] = [];
    const client = {
      from: () => ({
        upsert: async () => ({ error: null }),
        delete: () => {
          const filters: unknown[] = [];
          const query = Object.assign(Promise.resolve({ error: null }), {
            eq: (_c: string, v: unknown) => {
              filters.push(v);
              if (filters.length === 1) deleted.push(filters);
              return query;
            },
            in: async () => ({ error: null }),
          });
          return query;
        },
      }),
    };
    await applyWrites(client as never, w);
    // Only while still computed: a manual time written elsewhere survives.
    expect(deleted).toEqual([["facu", "casa", false]]);
    // Same address: nothing is dropped.
    expect(
      reducer(before, { type: "savePlace", place: { ...facu }, now: NOW }).travelTimes,
    ).toEqual(before.travelTimes);
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

function Spots() {
  const { data } = useStore();
  return <output data-testid="spots">{JSON.stringify(data.spots ?? [])}</output>;
}

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
    // Focusing and leaving without typing keeps a computed time computed.
    const computed = screen.getByLabelText("Minutos de Facultad de Ingeniería a Casa");
    fireEvent.focus(computed);
    await act(async () => {
      fireEvent.blur(computed);
    });
    expect(screen.getByText(/Facultad de Ingeniería → Casa/).textContent).toContain("calculado");
  });

  it("waits for the server to time an address before asking", () => {
    render(
      <StoreProvider
        initial={() => data({ events: [event("x", "Inglés", 10, "Instituto Anglo")] })}
        persist={false}
        fixedNow={NOW}
      >
        <Inbox />
      </StoreProvider>,
    );
    expect(screen.getByText("Calculando el traslado a «Instituto Anglo»…")).toBeTruthy();
    expect(screen.queryByLabelText("Lugar de Inglés")).toBeNull();
  });

  it("asks where an event is, finding saved places as you type", async () => {
    localStorage.clear();
    render(
      <StoreProvider
        initial={() => data({ events: [event("x", "Inglés", 10, "Instituto Anglo")] })}
        persist
        fixedNow={NOW}
      >
        <Inbox />
        <Probe />
      </StoreProvider>,
    );
    expect(screen.getByText("¿Dónde es?")).toBeTruthy();
    const search = screen.getByLabelText("Lugar de Inglés");
    fireEvent.change(search, { target: { value: "ingen" } });
    expect(screen.getByRole("button", { name: /Facultad de Ingeniería/ })).toBeTruthy();
    fireEvent.change(search, { target: { value: "nada que ver" } });
    expect(screen.getByText("Ningún lugar guardado coincide.")).toBeTruthy();
    fireEvent.change(search, { target: { value: "fing" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Facultad de Ingeniería/ }));
    });
    expect(screen.queryByText("¿Dónde es?")).toBeNull();
    expect(screen.getByTestId("places").textContent).toContain("Instituto Anglo");
  });

  it("explains the minutes format, and why «Usar» is off for 1441", () => {
    render(
      <StoreProvider
        initial={() => data({ events: [event("x", "Inglés", 10, "Instituto Anglo")] })}
        fixedNow={NOW}
      >
        <Inbox />
      </StoreProvider>,
    );
    const field = screen.getByLabelText("O minutos desde casa");
    // Described by its help text, even for a place name with spaces.
    expect(field.getAttribute("aria-describedby")).not.toMatch(/\s/);
    expect(
      document.getElementById(field.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toMatch(/Minutos de 0 a 1440/);
    fireEvent.change(field, { target: { value: "1441" } });
    expect(screen.getByRole("alert").textContent).toMatch(/de 0 a 1440/);
    expect((screen.getByRole("button", { name: "Usar" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field, { target: { value: "12,5" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("takes minutes for an event and saves the place only if asked", async () => {
    localStorage.clear();
    render(
      <StoreProvider
        initial={() =>
          data({
            events: [event("x", "Inglés", 10, "Instituto Anglo"), event("y", "Fútbol", 18)],
          })
        }
        persist
        fixedNow={NOW}
      >
        <Inbox />
        <Probe />
        <Spots />
      </StoreProvider>,
    );
    const [first, second] = screen.getAllByLabelText("O minutos desde casa");
    fireEvent.change(first as HTMLElement, { target: { value: "15" } });
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Usar" })[0] as HTMLElement);
    });
    // Used for the trip, not saved as a place.
    expect(screen.getByTestId("spots").textContent).toContain('"minutes":15');
    expect(screen.getByTestId("places").textContent).not.toContain("Instituto Anglo");

    fireEvent.change(second as HTMLElement, { target: { value: "20" } });
    fireEvent.click(screen.getByLabelText("Guardar como lugar"));
    const usar = screen.getByRole("button", { name: "Usar" }) as HTMLButtonElement;
    // A place needs a name.
    expect(usar.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Nombre del lugar"), { target: { value: "Cancha" } });
    await act(async () => {
      fireEvent.click(usar);
    });
    expect(screen.queryByText("¿Dónde es?")).toBeNull();
    expect(screen.getByTestId("places").textContent).toContain('"name":"Cancha"');
    expect(screen.getByTestId("spots").textContent).not.toContain("Fútbol");
  });

  it("marks an event as needing no trip", async () => {
    localStorage.clear();
    render(
      <StoreProvider
        initial={() => data({ events: [event("x", "Zoom", 10)] })}
        persist
        fixedNow={NOW}
      >
        <Inbox />
      </StoreProvider>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "No hace falta traslado" }));
    });
    expect(screen.queryByText("¿Dónde es?")).toBeNull();
  });
});
