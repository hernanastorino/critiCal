// The regular bus routes that start or end at a place (SPEC §15): seen and deleted here.
import { useEffect, useState } from "react";
import {
  asNew,
  deleteRoute,
  loadRoutes,
  type RouteRow,
  saveRoute,
  weekdayLabel,
} from "../busRoutes.js";
import { useSync } from "../Connected.js";
import type { Place } from "../model.js";
import { useStore } from "../store.js";
import { hhmm } from "../transit.js";

export function PlaceRoutes({ place }: { place: Place }) {
  const sync = useSync();
  const { data } = useStore();
  const client = sync?.client;
  const [routes, setRoutes] = useState<RouteRow[] | null>(null);
  const [note, setNote] = useState<{ text: string; undo?: () => void } | null>(null);
  useEffect(() => {
    if (!client) return;
    let live = true;
    void loadRoutes(client).then((rows) => {
      if (live) setRoutes(rows ?? []);
    });
    return () => {
      live = false;
    };
  }, [client]);

  const mine = (routes ?? []).filter((r) => r.from_place === place.id || r.to_place === place.id);
  if (!client || (!mine.length && !note)) return null;
  const name = (id: string) => (data.places ?? []).find((p) => p.id === id)?.name ?? "?";

  const forget = async (route: RouteRow) => {
    if (!(await deleteRoute(client, route.id))) {
      setNote({ text: "No pude borrar la ruta: probá de nuevo." });
      return;
    }
    const rest = (routes ?? []).filter((r) => r.id !== route.id);
    setRoutes(rest);
    setNote({
      text: "Ruta habitual borrada.",
      undo: () => {
        void saveRoute(client, asNew(route), rest).then((back) => {
          if (back) setRoutes([...rest, back]);
          setNote(null);
        });
      },
    });
  };

  return (
    <section className="field" aria-label="Rutas habituales">
      <span>Rutas habituales en ómnibus</span>
      <ul className="bus-routes">
        {mine.map((r) => (
          <li key={r.id}>
            {name(r.from_place)} → {name(r.to_place)} · {weekdayLabel(r.weekday)} ·{" "}
            {r.mode === "arrive" ? "llegar" : "salir"} a las {hhmm(r.time_minutes)} ·{" "}
            {r.plan.option.totalMinutes} min{" "}
            <button
              type="button"
              className="btn small"
              aria-label={`Borrar la ruta ${name(r.from_place)} a ${name(r.to_place)} ${weekdayLabel(r.weekday)}`}
              onClick={() => void forget(r)}
            >
              Borrar
            </button>
          </li>
        ))}
      </ul>
      {note && (
        <span className="meta" role="status">
          {note.text}{" "}
          {note.undo && (
            <button type="button" className="btn small" onClick={note.undo}>
              Deshacer
            </button>
          )}
        </span>
      )}
      <span className="meta">
        Se guardan desde la tarjeta de un evento y se usan mientras los horarios sigan valiendo.
      </span>
    </section>
  );
}
