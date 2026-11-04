import { useId, useState } from "react";
import type { Place } from "../model.js";
import { searchPlaces } from "../places.js";
import { useStore } from "../store.js";

/**
 * A search box over the saved places that suggests matches as you type, like a web
 * search: "clara" lists "Casa de Clara" and "Trabajo de Clara" to pick from. Plain
 * buttons under the box (reachable with Tab); a polite status says how many match.
 */
export function PlaceSearch({ label, onPick }: { label: string; onPick: (place: Place) => void }) {
  const { data } = useStore();
  const [query, setQuery] = useState("");
  const status = useId();
  const hits = searchPlaces(data, query);
  const typed = query.trim().length > 0;
  return (
    <div className="search">
      <input
        type="search"
        aria-label={label}
        aria-describedby={status}
        placeholder="Buscar un lugar guardado…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p id={status} className="sr-only" aria-live="polite">
        {typed ? (hits.length === 1 ? "1 lugar coincide" : `${hits.length} lugares coinciden`) : ""}
      </p>
      {typed && (
        <div className="suggestions">
          {hits.length === 0 && <p className="meta">Ningún lugar guardado coincide.</p>}
          {hits.map((p) => (
            <button
              key={p.id}
              type="button"
              className="suggestion"
              onClick={() => {
                setQuery("");
                onPick(p);
              }}
            >
              <span>
                {p.isHome ? "🏠 " : ""}
                {p.name}
              </span>
              {p.address && <span className="meta">{p.address}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
