import { useId, useState } from "react";
import type { Place } from "../model.js";
import { searchPlaces } from "../places.js";
import { useStore } from "../store.js";

/**
 * A search box over the saved places that suggests matches as you type, like a web
 * search: "clara" lists "Casa de Clara" and "Trabajo de Clara" to pick from.
 */
export function PlaceSearch({ label, onPick }: { label: string; onPick: (place: Place) => void }) {
  const { data } = useStore();
  const [query, setQuery] = useState("");
  const list = useId();
  const hits = searchPlaces(data, query);
  return (
    <div className="search">
      <input
        type="search"
        role="combobox"
        aria-label={label}
        aria-expanded={hits.length > 0}
        aria-controls={list}
        aria-autocomplete="list"
        placeholder="Buscar un lugar guardado…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query.trim() && (
        <div id={list} className="suggestions" role="listbox">
          {hits.length === 0 && <p className="meta">Ningún lugar guardado coincide.</p>}
          {hits.map((p) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={false}
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
