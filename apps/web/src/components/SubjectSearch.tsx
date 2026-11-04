import { useId, useState } from "react";
import { normalize } from "../calendars.js";
import type { Activity } from "../engine.js";
import { useStore } from "../store.js";
import { isMateria } from "../subjects.js";

/**
 * Materias matching what the user types (name or aliases), suggested as you type:
 * plain buttons under the box, and a polite status with how many match.
 */
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
  const status = useId();
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
        aria-label={label}
        aria-describedby={status}
        placeholder="Buscar una materia…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p id={status} className="sr-only" aria-live="polite">
        {terms.length ? `${hits.length} materias coinciden` : ""}
      </p>
      {terms.length > 0 && (
        <div className="suggestions">
          {hits.length === 0 && <p className="meta">Ninguna materia coincide.</p>}
          {hits.map((a) => (
            <button
              key={a.id}
              type="button"
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
