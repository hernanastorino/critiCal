import { useId, useState } from "react";
import { normalize } from "../calendars.js";
import type { Activity } from "../engine.js";
import { useStore } from "../store.js";
import { isMateria } from "../subjects.js";

/** Materias matching what the user types (name or aliases), suggested as you type. */
export function SubjectSearch({
  label,
  onPick,
  exclude,
}: {
  label: string;
  onPick: (subject: Activity) => void;
  exclude?: string;
}) {
  const { data } = useStore();
  const [query, setQuery] = useState("");
  const list = useId();
  const terms = normalize(query).split(" ").filter(Boolean);
  const hits = terms.length
    ? data.activities.filter((a) => {
        if (!isMateria(a) || a.id === exclude) return false;
        const words = [a.name, ...(a.aliases ?? [])].flatMap((n) => normalize(n).split(" "));
        return terms.every((q) => words.some((w) => w.startsWith(q)));
      })
    : [];
  return (
    <div className="search">
      <input
        type="search"
        role="combobox"
        aria-label={label}
        aria-expanded={hits.length > 0}
        aria-controls={list}
        aria-autocomplete="list"
        placeholder="Buscar una materia…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {terms.length > 0 && (
        <div id={list} className="suggestions" role="listbox">
          {hits.length === 0 && <p className="meta">Ninguna materia coincide.</p>}
          {hits.map((a) => (
            <button
              key={a.id}
              type="button"
              role="option"
              aria-selected={false}
              className="suggestion"
              onClick={() => {
                setQuery("");
                onPick(a);
              }}
            >
              <span>
                <span className="swatch" style={{ background: a.color }} /> {a.name}
              </span>
              {a.aliases?.length ? <span className="meta">{a.aliases.join(", ")}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
