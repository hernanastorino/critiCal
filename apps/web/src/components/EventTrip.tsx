// How to get to an event: car or bus (SPEC §15). For that event only; the default of
// each place is set in «Lugares». With the bus, the line, the stop and the time it passes,
// there and back, and the regular route kept for each way.
import { type ReactNode, useEffect, useRef, useState } from "react";
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
import { isTestDemo } from "../demoPruebas.js";
import { demoPlan } from "../demoTransit.js";
import type { AppEvent, TravelMode } from "../model.js";
import { busMinutes } from "../places.js";
import { earlyTripText, placeClashes } from "../planning.js";
import { busFeedVersion, planBus } from "../remote.js";
import { useStore } from "../store.js";
import { hhmm, type PlanResponse, type StaleReason, type TransitOption } from "../transit.js";
import { useBusRoutes } from "../useBusRoutes.js";
import { EventSpot } from "./EventSpot.js";

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

function staleNote(reason: StaleReason): string {
  switch (reason) {
    case "feed":
      return "Cambiaron los horarios de ómnibus desde que guardaste la ruta habitual.";
    case "time":
      return "El horario cambió desde que guardaste la ruta habitual.";
    case "day":
      return "La ruta habitual guardada no corre ese día.";
    case "expired":
      return "Los horarios de la ruta habitual ya vencieron.";
  }
}

/** One line when this event overlaps another fixed one at a different place. */
export function PlaceClash({ event }: { event: AppEvent }) {
  const { data, now } = useStore();
  const others = event.end > now ? placeClashes(data, event) : [];
  const first = others.at(0);
  if (!first) return null;
  const [a, b, ...rest] = others;
  const names = (e: AppEvent | undefined) => `«${e?.title ?? ""}»`;
  const who =
    others.length === 1
      ? names(first)
      : others.length === 2
        ? `${names(a)} y ${names(b)}`
        : `${names(a)} y ${rest.length + 1} más`;
  return (
    <p className="meta" role="note">
      Se superpone con {who}, en otro lugar.
    </p>
  );
}

type Result = { for: string; res: PlanResponse } | null;

/** The mode picker for an event held at a saved place, and the bus plan when it is the bus. */
export function EventTrip({ event }: { event: AppEvent }) {
  const { data, now, dispatch, earlyTrips } = useStore();
  const sync = useSync();
  // The test demo has no account: its bus plans are invented (demoTransit.ts).
  const demo = !sync && isTestDemo();
  const tz = data.settings.timezone;
  const trip = tripOf(data, event);
  const early = earlyTrips.find((t) => t.event.id === event.id);
  // A trip already made is history; one with no saved place or home has nothing to choose.
  if (event.end <= now) return null;
  if (!trip) return event.busy ? <EventSpot event={event} /> : null;
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
      {early && (
        <p className="meta" role="note">
          {earlyTripText(tz, early)}
        </p>
      )}
      {trip.mode === "bus" &&
        (["there", "back"] as const).map((way) => (
          <BusWay
            key={way}
            event={event}
            trip={trip}
            way={way}
            tz={tz}
            signedIn={!!sync || demo}
            demo={demo}
          />
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
  demo,
}: {
  event: AppEvent;
  trip: Trip;
  way: Way;
  tz: string;
  signedIn: boolean;
  demo: boolean;
}) {
  const { dispatch } = useStore();
  const client = useSync()?.client;
  const routes = useBusRoutes();
  const request = client || demo ? planRequestFor(trip, event, tz, way) : null;
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
  const waitingForFeed = !!route && !checked;
  const asked = request && !saved && !waitingForFeed ? request : null;

  // One key per question, so an answer is only shown for the question it answers.
  const key = asked ? JSON.stringify(asked) : "";
  const [result, setResult] = useState<Result>(null);
  const latest = useRef(asked);
  latest.current = asked;
  useEffect(() => {
    const question = latest.current;
    if (!question || !key) return;
    if (!client) {
      if (demo) setResult({ for: key, res: demoPlan(question) });
      return;
    }
    let live = true;
    void planBus(client, question).then((res) => {
      if (live) setResult({ for: key, res });
    });
    return () => {
      live = false;
    };
  }, [client, demo, key]);

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

  const title = way === "there" ? "Ida" : "Vuelta";
  return (
    <section className="bus-way" aria-label={title}>
      <BusPlan
        title={title}
        signedIn={signedIn}
        missing={unlocatedEnd(trip)}
        answer={answer}
        waiting={!!request && !answer}
        home={trip.from.name}
        place={trip.place.name}
      >
        {saved && (
          <p className="meta">Ruta habitual guardada: se usa sin consultar los horarios.</p>
        )}
        {route && stale && (
          <p className="meta">{staleNote(stale)} Esto es lo que dan los horarios de hoy.</p>
        )}
        {client && best && !saved && slot && (
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
      </BusPlan>
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

/**
 * One way as a single line («Ida · salís 11:35 · líneas 701 y 710»); touching it opens the detail
 * (stops, transfers, walks, arrival) and `children`, the regular-route controls. The data
 * attribution lives in Ajustes → Acerca de, not here.
 */
export function BusPlan({
  title = "",
  signedIn,
  missing,
  answer,
  waiting,
  home,
  place,
  children,
}: {
  title?: string;
  signedIn: boolean;
  missing: ReturnType<typeof unlocatedEnd>;
  answer: PlanResponse | null;
  waiting: boolean;
  home: string;
  place: string;
  children?: ReactNode;
}) {
  const note = noPlanNote({ signedIn, missing, answer, waiting, home, place });
  if (note) {
    return (
      <>
        {title && <h4>{title}</h4>}
        <p className="meta">{note}</p>
      </>
    );
  }
  if (!answer?.ok) return null;
  // The best option is the first: the note above already covered there being none.
  const best = answer.options[0];
  if (!best) return null;
  return (
    <LegDetail title={title} best={best} raised={answer.raised}>
      {children}
    </LegDetail>
  );
}

/** The line of a way, and under it the detail that opens on touching it. */
function LegDetail({
  title,
  best,
  raised,
  children,
}: {
  title: string;
  best: TransitOption;
  raised?: boolean;
  children?: ReactNode;
}) {
  return (
    <details className="bus-plan bus-leg">
      <summary>{legLine(title, best)}</summary>
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
      {raised && <p className="meta">Con un solo ómnibus no llegás: este lleva dos transbordos.</p>}
      {children}
    </details>
  );
}

/** «Línea 701», «líneas 701 y 710», «líneas 17, 128 y 710»: the lines in the order they are taken. */
const linesText = (lines: readonly string[]): string => {
  const last = lines.at(-1);
  if (last === undefined) return "a pie";
  if (lines.length === 1) return `línea ${last}`;
  return `líneas ${lines.slice(0, -1).join(", ")} y ${last}`;
};

/** «Ida · salís 11:35 · líneas 701 y 710». */
export function legLine(title: string, option: TransitOption): string {
  const lines = option.legs.flatMap((l) => (l.kind === "walk" ? [] : [l.line]));
  return [title, `salís ${hhmm(option.leaveMin)}`, linesText(lines)].filter(Boolean).join(" · ");
}
