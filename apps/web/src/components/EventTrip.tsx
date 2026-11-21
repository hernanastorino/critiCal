// How to get to an event: car or bus (SPEC §15). For that event only; the default of
// each place is set in «Lugares». With the bus, the line, the stop and the time it passes.
import { useEffect, useRef, useState } from "react";
import { placeMode, planRequestFor, stepsOf, summaryOf, tripOf, unlocatedEnd } from "../busTrip.js";
import { useSync } from "../Connected.js";
import type { AppEvent, TravelMode } from "../model.js";
import { planBus } from "../remote.js";
import { useStore } from "../store.js";
import { hhmm, type PlanOk, type PlanResponse, type TransitOption } from "../transit.js";

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

type Result = { for: string; res: PlanResponse } | null;

/** The mode picker for an event held at a saved place, and the bus plan when it is the bus. */
export function EventTrip({ event }: { event: AppEvent }) {
  const { data, now, dispatch } = useStore();
  const sync = useSync();
  const tz = data.settings.timezone;
  const trip = tripOf(data, event);
  const request = trip && trip.mode === "bus" && sync ? planRequestFor(trip, event, tz) : null;
  // One key per question, so an answer is only shown for the question it answers.
  const key = request ? JSON.stringify(request) : "";
  const [result, setResult] = useState<Result>(null);
  const client = sync?.client;
  const asked = useRef(request);
  asked.current = request;
  useEffect(() => {
    const question = asked.current;
    if (!client || !question || !key) return;
    let live = true;
    void planBus(client, question).then((res) => {
      if (live) setResult({ for: key, res });
    });
    return () => {
      live = false;
    };
  }, [client, key]);

  // A trip already made is history; one with no saved place or home has nothing to choose.
  if (!trip || event.end <= now) return null;
  const choose = (mode: TravelMode) => {
    dispatch({
      type: "tripMode",
      eventId: event.id,
      mode: mode === placeMode(trip.place) ? null : mode,
    });
  };
  const answer = result?.for === key ? result.res : null;
  const missing = unlocatedEnd(trip);

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
        <BusPlan
          signedIn={!!sync}
          missing={missing}
          answer={answer}
          waiting={!!request && !answer}
          home={trip.from.name}
          place={trip.place.name}
        />
      )}
    </div>
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
