// How to get to an event: car or bus (SPEC §15). For that event only; the default of
// each place is set in «Lugares». With the bus, the line, the stop and the time it passes,
// there and back, and the regular route kept for each way.
import { useEffect, useRef, useState } from "react";
import {
  deleteRoute,
  findRoute,
  routeAnswer,
  routeRow,
  routeStale,
  routesChanged,
  saveRoute,
  slotOf,
} from "../busRoutes.js";
import {
  placeMode,
  planRequestFor,
  stepsOf,
  summaryOf,
  type EventTrip as Trip,
  tripOf,
  unlocatedEnd,
  type Way,
  wayMinutes,
} from "../busTrip.js";
import { useSync } from "../Connected.js";
import type { AppEvent, TravelMode } from "../model.js";
import { busMinutes } from "../places.js";
import { busFeedVersion, planBus } from "../remote.js";
import { useStore } from "../store.js";
import {
  hhmm,
  type PlanOk,
  type PlanResponse,
  type StaleReason,
  type TransitOption,
} from "../transit.js";
import { useBusRoutes } from "../useBusRoutes.js";

const MODES: { mode: TravelMode; label: string }[] = [
  { mode: "car", label: "Auto" },
  { mode: "bus", label: "Ómnibus" },
];

const MESSAGES: Partial<Record<string, string>> = {
  unauthorized: "Volvé a entrar para ver los ómnibus.",
  rate_limited: "Pediste muchos traslados seguidos: probá en un minuto.",
  out_of_area: "Los horarios cubren Montevideo, Canelones y San José.",
  no_stops_near: "No hay paradas cerca de alguno de los dos lugares.",
  feed_unavailable: "Los horarios todavía no están cargados.",
  unreachable: "No pude consultar los horarios: ¿hay conexión?",
};

const WAY_TITLE = { there: "Ida", back: "Vuelta" } as const;

const STALE: Record<StaleReason, string> = {
  feed: "Cambiaron los horarios de ómnibus desde que guardaste la ruta habitual.",
  time: "El horario cambió desde que guardaste la ruta habitual.",
  day: "La ruta habitual guardada no corre ese día.",
  expired: "Los horarios de la ruta habitual ya vencieron.",
};

type Result = { for: string; res: PlanResponse } | null;

/** The mode picker for an event held at a saved place, and the bus plan when it is the bus. */
export function EventTrip({ event }: { event: AppEvent }) {
  const { data, now, dispatch } = useStore();
  const sync = useSync();
  const tz = data.settings.timezone;
  const trip = tripOf(data, event);
  // A trip already made is history; one with no saved place or home has nothing to choose.
  if (!trip || event.end <= now) return null;
  const choose = (mode: TravelMode) => {
    dispatch({
      type: "tripMode",
      eventId: event.id,
      mode: mode === placeMode(trip.place) ? null : mode,
    });
  };

  return (
    <div className="bubble-trip">
      <fieldset className="bubble-trip-head">
        <legend>Cómo llegar</legend>
        <div className="day-chips">
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              className={`chip${trip.mode === m.mode ? " on" : ""}`}
              aria-pressed={trip.mode === m.mode}
              onClick={() => {
                choose(m.mode);
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </fieldset>
      {trip.once && (
        <p className="meta">
          Solo esta vez ·{" "}
          <button
            type="button"
            className="btn small"
            onClick={() => {
              dispatch({ type: "tripMode", eventId: event.id, mode: null });
            }}
          >
            Volver a {placeMode(trip.place) === "bus" ? "ómnibus" : "auto"}
          </button>
        </p>
      )}
      {trip.mode === "bus" &&
        (["there", "back"] as const).map((way) => (
          <BusWay key={way} event={event} trip={trip} way={way} tz={tz} signedIn={!!sync} />
        ))}
      {trip.mode === "bus" && busMinutes(data, event) === undefined && (
        <p className="meta">Todavía no tengo los minutos del ómnibus: el plan usa los del auto.</p>
      )}
    </div>
  );
}

/** One way of the bus trip: its plan, and the regular route kept for it (SPEC §15). */
function BusWay({
  event,
  trip,
  way,
  tz,
  signedIn,
}: {
  event: AppEvent;
  trip: Trip;
  way: Way;
  tz: string;
  signedIn: boolean;
}) {
  const { dispatch } = useStore();
  const client = useSync()?.client;
  const routes = useBusRoutes(client);
  const request = client ? planRequestFor(trip, event, tz, way) : null;
  const slot = request ? slotOf(trip, event, tz, way, request) : null;
  const route = slot ? findRoute(routes, slot) : undefined;

  // A saved route is preferred while it still holds: the schedules it came from are the
  // ones now, and it runs that day. The server is asked for the version only when there
  // is a route; offline, the route is trusted (that is what it is kept for).
  const [feed, setFeed] = useState<{ route: string; version: string | null } | null>(null);
  const routeId = route?.id;
  useEffect(() => {
    if (!client || !routeId) return;
    let live = true;
    void busFeedVersion(client).then((version) => {
      if (live) setFeed({ route: routeId, version });
    });
    return () => {
      live = false;
    };
  }, [client, routeId]);
  const checked = route && feed?.route === route.id ? feed : null;
  const stale = route && request && checked ? routeStale(route, request, checked.version) : null;
  const saved = route && request && checked && !stale ? route : undefined;
  const asked = !request || saved || (route && !checked) ? null : request;

  // One key per question, so an answer is only shown for the question it answers.
  const key = asked ? JSON.stringify(asked) : "";
  const [result, setResult] = useState<Result>(null);
  const latest = useRef(asked);
  latest.current = asked;
  useEffect(() => {
    const question = latest.current;
    if (!client || !question || !key) return;
    let live = true;
    void planBus(client, question).then((res) => {
      if (live) setResult({ for: key, res });
    });
    return () => {
      live = false;
    };
  }, [client, key]);

  const answer: PlanResponse | null = saved
    ? routeAnswer(saved)
    : key && result?.for === key
      ? result.res
      : null;

  // The plan reserves the bus's minutes (SPEC §15), kept with the event so the engine
  // never needs the network.
  const best = answer?.ok ? answer.options[0] : undefined;
  const minutes = best && request ? wayMinutes(best, way, request) : undefined;
  useEffect(() => {
    if (minutes === undefined) return;
    dispatch({ type: "tripMinutes", eventId: event.id, minutes, way, start: event.start });
  }, [minutes, way, event.id, event.start, dispatch]);

  const [problem, setProblem] = useState<string | null>(null);
  const keep = async () => {
    if (!client || !slot || !best || !answer?.ok) return;
    setProblem(null);
    const row = routeRow(slot, best, answer, answer.dayType);
    if (await saveRoute(client, row, route?.id)) routesChanged();
    else setProblem("No pude guardar la ruta: probá de nuevo.");
  };
  const drop = async () => {
    if (!client || !route) return;
    setProblem(null);
    if (await deleteRoute(client, route.id)) routesChanged();
    else setProblem("No pude borrar la ruta: probá de nuevo.");
  };

  return (
    <section className="bus-way" aria-label={WAY_TITLE[way]}>
      <h4>{WAY_TITLE[way]}</h4>
      <BusPlan
        signedIn={signedIn}
        missing={unlocatedEnd(trip)}
        answer={answer}
        waiting={!!request && !answer}
        home={trip.from.name}
        place={trip.place.name}
      />
      {saved && <p className="meta">Ruta habitual guardada: se usa sin consultar los horarios.</p>}
      {route && stale && (
        <p className="meta">{STALE[stale]} Esto es lo que dan los horarios de hoy.</p>
      )}
      {best && !saved && slot && (
        <button type="button" className="btn small" onClick={() => void keep()}>
          {route ? "Actualizar ruta habitual" : "Guardar como ruta habitual"}
        </button>
      )}
      {saved && (
        <button type="button" className="btn small" onClick={() => void drop()}>
          Borrar ruta habitual
        </button>
      )}
      {problem && (
        <p className="meta" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}

/** Why there is no plan to show (yet), in words; null when there is one. */
function noPlanNote(p: {
  signedIn: boolean;
  missing: ReturnType<typeof unlocatedEnd>;
  answer: PlanResponse | null;
  waiting: boolean;
  home: string;
  place: string;
}): string | null {
  if (!p.signedIn) return "Los horarios de ómnibus necesitan tu cuenta.";
  if (p.missing) return missingNote(p.missing, p.home, p.place);
  if (p.waiting || !p.answer) return "Buscando ómnibus…";
  if (!p.answer.ok) return MESSAGES[p.answer.error] ?? "No pude calcular el ómnibus.";
  if (p.answer.options.length) return null;
  return p.answer.walkOnly
    ? `Está a ${p.answer.walkOnly.minutes} min caminando.`
    : "Ningún ómnibus llega a tiempo: andá en auto o salí antes.";
}

function missingNote(missing: "from" | "to" | "area", home: string, place: string): string {
  if (missing === "area") return MESSAGES.out_of_area ?? "";
  return `Falta ubicar ${missing === "from" ? home : place}: guardá su dirección en Lugares.`;
}

export function BusPlan({
  signedIn,
  missing,
  answer,
  waiting,
  home,
  place,
}: {
  signedIn: boolean;
  missing: ReturnType<typeof unlocatedEnd>;
  answer: PlanResponse | null;
  waiting: boolean;
  home: string;
  place: string;
}) {
  const note = noPlanNote({ signedIn, missing, answer, waiting, home, place });
  if (note) return <p className="meta">{note}</p>;
  if (!answer?.ok) return null;
  // The best option is the first: the note above already covered there being none.
  return <>{answer.options.slice(0, 1).map((best) => bestOption(best, answer))}</>;
}

function bestOption(best: TransitOption, answer: PlanOk) {
  return (
    <div className="bus-plan" key="best">
      <p>
        <strong>{summaryOf(best)}</strong>
        {best.transfers > 0 &&
          ` · ${best.transfers} ${best.transfers === 1 ? "transbordo" : "transbordos"}`}
      </p>
      <ol className="bus-steps">
        {stepsOf(best).map((s, i) => (
          // The same line can come back after a transfer: the position tells the steps apart.
          // biome-ignore lint/suspicious/noArrayIndexKey: steps never reorder
          <li key={i}>
            {s.text}
            {s.bus && ` → bajás en ${s.bus.alight.name} (${hhmm(s.bus.alightMin)})`}
          </li>
        ))}
      </ol>
      {answer.raised && (
        <p className="meta">Con un solo ómnibus no llegás: este lleva dos transbordos.</p>
      )}
      <p className="meta">
        {best.theoretical ? "Horario teórico, sin tiempo real. " : ""}
        {answer.attribution}
      </p>
    </div>
  );
}
