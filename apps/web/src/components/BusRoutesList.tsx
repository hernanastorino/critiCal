// The regular bus routes the user kept (SPEC §15): seen and deleted where the places are.
// They are saved from an event's card; here there is nothing to compute.
import { useState } from "react";
import { deleteRoute, routesChanged } from "../busRoutes.js";
import { useSync } from "../Connected.js";
import type { Place } from "../model.js";
import { hhmm } from "../transit.js";
import { useBusRoutes } from "../useBusRoutes.js";

const WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

export function BusRoutesList({ places }: { places: readonly Place[] }) {
  const client = useSync()?.client;
  const routes = useBusRoutes(client);
  const [problem, setProblem] = useState<string | null>(null);
  if (!client) return null;
  const nameOf = (id: string) => places.find((p) => p.id === id)?.name ?? "?";

  return (
    <details className="fold">
      <summary>
        Rutas de ómnibus <span className="meta">{routes.length}</span>
      </summary>
      <p className="meta">
        Las guardás desde un evento en ómnibus. Mientras sigan valiendo, se usan sin consultar los
        horarios.
      </p>
      {routes.map((r) => {
        const line = r.plan.option.legs.flatMap((l) => (l.kind === "bus" ? [l.line] : []));
        const label = `${nameOf(r.from_place)} → ${nameOf(r.to_place)}`;
        return (
          <div key={r.id} className="check" style={{ flexWrap: "wrap" }}>
            <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
              {label}
              <span className="meta place-aliases">
                {r.weekday ? WEEKDAYS[r.weekday - 1] : "todos los días"} ·{" "}
                {r.mode === "arrive" ? "llegar" : "salir"} {hhmm(r.time_minutes)}
                {line.length ? ` · línea ${line.join(" y ")}` : ""}
              </span>
            </span>
            <button
              type="button"
              className="btn small"
              aria-label={`Borrar la ruta ${label}`}
              onClick={() => {
                setProblem(null);
                void deleteRoute(client, r.id).then((ok) => {
                  if (ok) routesChanged();
                  else setProblem("No pude borrar la ruta: probá de nuevo.");
                });
              }}
            >
              Borrar
            </button>
          </div>
        );
      })}
      {routes.length === 0 && <p className="meta">Todavía no guardaste ninguna ruta.</p>}
      {problem && (
        <p className="meta" role="alert">
          {problem}
        </p>
      )}
    </details>
  );
}
