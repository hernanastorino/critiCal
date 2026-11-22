// How to get to an event: car or bus (SPEC §15). For that event only; the default of
// each place is set in «Lugares». With the bus, the line, the stop and the time it passes,
// on the way there and on the way back, and the route kept as a regular one.
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import {
  asNew,
  deleteRoute,
  findRoute,
  loadRoutes,
  type NewRoute,
  planOf,
  type RouteRow,
  savedPlanOf,
  saveRoute,
  weekdayLabel,
} from "../busRoutes.js";
import {
  placeMode,
  planRequestFor,
  slotFor,
  stepsOf,
  summaryOf,
  type EventTrip as Trip,
  tripOf,
  unlocatedEnd,
} from "../busTrip.js";
import { useSync } from "../Connected.js";
import type { TripLeg } from "../engine.js";
import type { AppEvent, TravelMode } from "../model.js";
import { busMinutes } from "../places.js";
import { busFeed, planBus } from "../remote.js";
import { useStore } from "../store.js";
import {
  ATTRIBUTION,
  hhmm,
  isoWeekday,
  type PlanOk,
  type PlanResponse,
  type StaleReason,
  staleReason,
  type TransitOption,
} from "../transit.js";

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

const STALE: Record<StaleReason, string> = {
  feed: "cambiaron los horarios",
  time: "cambió la hora",
  day: "no corre ese día",
  expired: "los horarios terminan antes de esa fecha",
};

/** The saved routes of the user; null until read. */
function useRoutes(client: SupabaseClient | undefined, enabled: boolean) {
  const [routes, setRoutes] = useState<RouteRow[] | null>(null);
  useEffect(() => {
    if (!client || !enabled) return;
    let live = true;
    void loadRoutes(client).then((rows) => {
      // Routes that cannot be read are no routes: the plan is asked for as usual.
      if (live) setRoutes(rows ?? []);
    });
    return () => {
      live = false;
    };
  }, [client, enabled]);
  return [routes, setRoutes] as const;
}

/** The mode picker for an event held at a saved place, and the bus plan when it is the bus. */
export function EventTrip({ event }: { event: AppEvent }) {
  const { data, now, dispatch } = useStore();
  const sync = useSync();
  const trip = tripOf(data, event);
  const [routes, setRoutes] = useRoutes(sync?.client, !!trip && trip.mode === "bus");

  // A trip already made is history; one with no saved place or home has nothing to choose.
  if (!trip || event.end <= now) return null;
  const choose = (mode: TravelMode) => {
    dispatch({
      type: "tripMode",
      eventId: event.id,
      mode: mode === placeMode(trip.place) ? null : mode,
    });
  };
  const there = busMinutes(data, event);

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
      {trip.mode === "bus" && (
        <>
          {(["there", "back"] as const).map((leg) => (
            <BusLeg
              key={leg}
              leg={leg}
              event={event}
              trip={trip}
              routes={routes}
              onRoutes={setRoutes}
            />
          ))}
          {there === undefined && (
            <p className="meta">
              Todavía no tengo los minutos del ómnibus: el plan usa los del auto.
            </p>
          )}
          {there !== undefined && busMinutes(data, event, "back") === undefined && (
            <p className="meta">
              Todavía no tengo los minutos de la vuelta: el plan usa los de la ida.
            </p>
          )}
        </>
      )}
    </div>
  );
}

type Result = { for: string; res: PlanResponse; habitual?: RouteRow; stale?: StaleReason } | null;

/**
 * One leg of the bus trip: asks for it (or takes the saved regular route while it still
 * holds), tells the plan how long it takes, and offers to keep it as a regular route.
 */
function BusLeg({
  leg,
  event,
  trip,
  routes,
  onRoutes,
}: {
  leg: TripLeg;
  event: AppEvent;
  trip: Trip;
  routes: RouteRow[] | null;
  onRoutes: (rows: RouteRow[]) => void;
}) {
  const { data, dispatch } = useStore();
  const sync = useSync();
  const client = sync?.client;
  const request = sync ? planRequestFor(trip, event, data.settings.timezone, leg) : null;
  const slot = request ? slotFor(trip, request) : null;
  const saved = routes && slot ? findRoute(routes, slot) : undefined;
  // One key per question, so an answer is only shown for the question it answers.
  const key = request ? JSON.stringify(request) : "";
  const [result, setResult] = useState<Result>(null);
  // «Recalcular»: the saved route is left out for this question.
  const [skipped, setSkipped] = useState("");
  const [note, setNote] = useState<{ text: string; undo?: () => void } | null>(null);
  const latest = useRef({ request, saved });
  latest.current = { request, saved };
  const savedKey = saved ? `${saved.id}:${saved.computed_at}` : "";
  const ready = routes !== null;
  const skip = skipped === key;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `savedKey` stands for the saved route
  useEffect(() => {
    const { request: question, saved: route } = latest.current;
    if (!client || !question || !key || !ready) return;
    let current = true;
    void (async () => {
      let stale: StaleReason | undefined;
      if (route && !skip) {
        const feed = await busFeed(client);
        if (feed) {
          const at = {
            date: question.date,
            timeMinutes: route.time_minutes,
            dayType: question.dayType,
          };
          stale = staleReason(route, at, feed.version) ?? undefined;
          if (!stale) {
            if (current) {
              setResult({ for: key, res: planOf(route, ATTRIBUTION, feed), habitual: route });
            }
            return;
          }
        }
      }
      const res = await planBus(client, question);
      if (current) setResult({ for: key, res, stale });
    })();
    return () => {
      current = false;
    };
  }, [client, key, ready, savedKey, skip]);

  // The plan reserves the bus's minutes (SPEC §15): the best option's, door to door, kept
  // with the event so the engine never needs the network.
  const answered = result?.for === key ? result : null;
  const answer = answered?.res ?? null;
  const best = answer?.ok ? answer.options[0] : undefined;
  const minutes = best?.totalMinutes;
  useEffect(() => {
    if (minutes === undefined) return;
    if (leg === "there") {
      dispatch({ type: "tripMinutes", eventId: event.id, minutes, start: event.start });
    } else dispatch({ type: "tripBack", eventId: event.id, minutes, end: event.end });
  }, [minutes, leg, event.id, event.start, event.end, dispatch]);

  const missing = unlocatedEnd(trip);
  const [start, finish] = leg === "there" ? [trip.from, trip.place] : [trip.place, trip.from];
  const habitual = answered?.habitual;
  const weekday = request ? isoWeekday(request.date) : 1;

  const keep = async (day: number | null) => {
    if (!client || !slot || !best || !answer?.ok || !routes) return;
    const row: NewRoute = {
      from_place: slot.from,
      to_place: slot.to,
      weekday: day,
      time_minutes: slot.timeMinutes,
      mode: slot.mode,
      plan: savedPlanOf(best, answer),
      feed_version: answer.feed.version,
      theoretical: best.theoretical,
    };
    const made = await saveRoute(client, row, routes);
    if (!made) {
      setNote({ text: "No pude guardar la ruta: probá de nuevo." });
      return;
    }
    onRoutes([...routes.filter((r) => r.id !== made.id), made]);
    setNote({ text: `Guardada como ruta habitual ${weekdayLabel(day)}.` });
  };
  const forget = async (route: RouteRow) => {
    if (!client || !routes) return;
    if (!(await deleteRoute(client, route.id))) {
      setNote({ text: "No pude borrar la ruta: probá de nuevo." });
      return;
    }
    const rest = routes.filter((r) => r.id !== route.id);
    onRoutes(rest);
    setNote({
      text: "Ruta habitual borrada.",
      undo: () => {
        void saveRoute(client, asNew(route), rest).then((back) => {
          if (back) onRoutes([...rest, back]);
          setNote(null);
        });
      },
    });
  };

  const title = leg === "there" ? "Ida" : "Vuelta";
  return (
    <section className="bus-leg" aria-label={title}>
      <p className="bus-leg-title">
        <strong>{title}</strong> · {start?.name} → {finish?.name}
      </p>
      <BusPlan
        signedIn={!!sync}
        missing={missing}
        answer={answer}
        waiting={!!request && !answer}
        home={trip.from.name}
        place={trip.place.name}
        back={leg === "back"}
      />
      {answered?.stale && (
        <p className="meta">
          Tu ruta habitual ya no sirve ({STALE[answered.stale]}): calculé de nuevo.
        </p>
      )}
      {habitual && (
        <p className="meta">
          Ruta habitual ({weekdayLabel(habitual.weekday)}) ·{" "}
          <button type="button" className="btn small" onClick={() => setSkipped(key)}>
            Recalcular
          </button>{" "}
          <button type="button" className="btn small" onClick={() => void forget(habitual)}>
            Borrar ruta habitual
          </button>
        </p>
      )}
      {!habitual && best && routes && (
        <p className="meta">
          <button type="button" className="btn small" onClick={() => void keep(weekday)}>
            Guardar como ruta habitual {weekdayLabel(weekday)}
          </button>{" "}
          <button type="button" className="btn small" onClick={() => void keep(null)}>
            Guardar para todos los días
          </button>
        </p>
      )}
      {note && (
        <p className="meta" role="status">
          {note.text}{" "}
          {note.undo && (
            <button type="button" className="btn small" onClick={note.undo}>
              Deshacer
            </button>
          )}
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
  back?: boolean;
}): string | null {
  if (!p.signedIn) return "Los horarios de ómnibus necesitan tu cuenta.";
  if (p.missing) return missingNote(p.missing, p.home, p.place);
  if (p.waiting || !p.answer) return "Buscando ómnibus…";
  if (!p.answer.ok) return MESSAGES[p.answer.error] ?? "No pude calcular el ómnibus.";
  if (p.answer.options.length) return null;
  if (p.answer.walkOnly) return `Está a ${p.answer.walkOnly.minutes} min caminando.`;
  return p.back
    ? "No hay más ómnibus para volver después del evento: volvé en auto."
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
  back,
}: {
  signedIn: boolean;
  missing: ReturnType<typeof unlocatedEnd>;
  answer: PlanResponse | null;
  waiting: boolean;
  home: string;
  place: string;
  back?: boolean;
}) {
  const note = noPlanNote({ signedIn, missing, answer, waiting, home, place, back });
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
