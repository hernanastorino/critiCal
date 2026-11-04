import { useState } from "react";
import { useSync } from "../Connected.js";
import { CRITICAL, newId, nextColor } from "../model.js";
import { readSyllabus } from "../remote.js";
import { useStore } from "../store.js";
import { editedHours, type PlannedAssessment, type Syllabus, syllabusTasks } from "../syllabus.js";

const MAX_BYTES = 3_000_000;

const ERRORS: Record<string, string> = {
  server_not_configured: "Falta la clave de Gemini en el servidor.",
  too_large: "El PDF es muy grande (máximo 3 MB).",
  gemini_busy: "Gemini está saturado o sin cuota gratis por hoy. Probá más tarde.",
  unreadable: "No pude entender el programa. ¿Es el PDF correcto?",
};

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

interface Draft {
  subject: string;
  units: { title: string; hours: number; keep: boolean }[];
  assessments: (Syllabus["assessments"][number] & { key: string; keep: boolean; date: string })[];
}

const draftOf = (s: Syllabus): Draft => ({
  subject: s.subject,
  units: s.units.map((u) => ({ ...u, keep: true })),
  assessments: s.assessments.map((a, i) => ({
    ...a,
    key: `a${i}`,
    date: a.date ?? "",
    keep: true,
  })),
});

/** Hours field that keeps what is typed ("1,") until it loses focus, then bounds it. */
function HoursInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (hours: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      inputMode="decimal"
      style={{ width: 56 }}
      aria-label={label}
      value={text ?? String(value)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text !== null) onChange(editedHours(text));
        setText(null);
      }}
    />
  );
}

/** Cargar un programa en PDF: Gemini propone unidades y evaluaciones; nada se crea sin OK. */
export function SyllabusImport() {
  const sync = useSync();
  const { data, dispatch } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (!sync) return null;

  const read = async (file: File) => {
    setError(null);
    setDone(null);
    if (file.size > MAX_BYTES) {
      setError(ERRORS.too_large ?? null);
      return;
    }
    setBusy(true);
    const r = await readSyllabus(sync.client, await toBase64(file));
    setBusy(false);
    if (!r.ok) {
      setError(ERRORS[r.error] ?? "No se pudo leer el programa.");
      return;
    }
    setDraft(draftOf(r.syllabus));
  };

  const confirm = (d: Draft) => {
    const hours = new Map(d.units.filter((u) => u.keep).map((u) => [u.title, u.hours]));
    const assessments: PlannedAssessment[] = d.assessments
      .filter((a) => a.keep && a.date)
      .map((a) => ({
        title: a.title.trim() || "Evaluación",
        kind: a.kind,
        date: a.date,
        units: a.units
          .filter((t) => hours.has(t))
          .map((t) => ({ title: t, minutes: (hours.get(t) ?? 0) * 60 })),
        minutes: a.hours * 60,
      }));
    const { activity, isNew, tasks } = syllabusTasks({
      subject: d.subject.trim() || "Materia",
      activities: data.activities,
      assessments,
      timeZone: data.settings.timezone,
      newId,
      color: nextColor(data.activities),
    });
    if (isNew && tasks.length === 0) dispatch({ type: "saveActivity", activity });
    tasks.forEach((task, i) => {
      dispatch({ type: "saveTask", task, activity: isNew && i === 0 ? activity : undefined });
    });
    setDraft(null);
    setDone(`${activity.name}: ${tasks.length} evaluaciones agregadas ✓`);
  };

  const set = (patch: Partial<Draft>) => draft && setDraft({ ...draft, ...patch });
  /** Units of an assessment that are still kept: without any, its own hours count. */
  const covered = (a: Draft["assessments"][number]) =>
    a.units.filter((t) => draft?.units.some((u) => u.title === t && u.keep));

  return (
    <details className="card prefs">
      <summary className="title">Cargar programa (PDF) con IA</summary>
      <p className="meta">
        Gemini lee el programa y propone unidades, horas y evaluaciones. Revisás todo antes de crear
        nada. Usa el plan gratis de Google AI Studio (Google puede usar el PDF para mejorar sus
        modelos: no subas datos personales).
      </p>
      {!draft && (
        <label className="btn" style={{ width: "100%", textAlign: "center" }}>
          {busy ? "Leyendo…" : "Elegir PDF"}
          <input
            type="file"
            accept="application/pdf"
            hidden
            aria-label="Programa en PDF"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void read(f);
            }}
          />
        </label>
      )}
      {error && (
        <p className="meta" style={{ color: CRITICAL }}>
          {error}
        </p>
      )}
      {done && <p className="meta">{done}</p>}
      {draft && (
        <>
          <label className="field">
            <span>Materia</span>
            <input
              value={draft.subject}
              onChange={(e) => set({ subject: e.target.value })}
              aria-label="Nombre de la materia"
            />
          </label>
          <div className="title">Unidades (horas de estudio)</div>
          {draft.units.map((u, i) => (
            <label key={u.title} className="check">
              <input
                type="checkbox"
                checked={u.keep}
                onChange={(e) =>
                  set({
                    units: draft.units.map((x, j) =>
                      j === i ? { ...x, keep: e.target.checked } : x,
                    ),
                  })
                }
              />
              <span style={{ flex: 1 }}>{u.title}</span>
              <HoursInput
                label={`Horas de ${u.title}`}
                value={u.hours}
                onChange={(hours) =>
                  set({ units: draft.units.map((x, j) => (j === i ? { ...x, hours } : x)) })
                }
              />
            </label>
          ))}
          <div className="title">Evaluaciones</div>
          {draft.assessments.map((a, i) => (
            <div key={a.key} className="card">
              <label className="check">
                <input
                  type="checkbox"
                  checked={a.keep}
                  onChange={(e) =>
                    set({
                      assessments: draft.assessments.map((x, j) =>
                        j === i ? { ...x, keep: e.target.checked } : x,
                      ),
                    })
                  }
                />
                <input
                  style={{ flex: 1 }}
                  aria-label={`Nombre de ${a.key}`}
                  value={a.title}
                  onChange={(e) =>
                    set({
                      assessments: draft.assessments.map((x, j) =>
                        j === i ? { ...x, title: e.target.value } : x,
                      ),
                    })
                  }
                />
                <input
                  type="date"
                  aria-label={`Fecha de ${a.title}`}
                  value={a.date}
                  onChange={(e) =>
                    set({
                      assessments: draft.assessments.map((x, j) =>
                        j === i ? { ...x, date: e.target.value } : x,
                      ),
                    })
                  }
                />
              </label>
              <p className="meta">
                {covered(a).length ? `Abarca: ${covered(a).join(", ")}` : "Sin unidades: "}
                {!a.date && a.keep ? " · falta la fecha" : ""}
              </p>
              {covered(a).length === 0 && (
                <div className="check">
                  <span style={{ flex: 1 }}>Horas de preparación</span>
                  <HoursInput
                    label={`Horas de preparación de ${a.key}`}
                    value={a.hours}
                    onChange={(hours) =>
                      set({
                        assessments: draft.assessments.map((x, j) =>
                          j === i ? { ...x, hours } : x,
                        ),
                      })
                    }
                  />
                </div>
              )}
            </div>
          ))}
          <div className="row">
            <button
              type="button"
              className="btn primary"
              disabled={!draft.assessments.some((a) => a.keep && a.date)}
              onClick={() => confirm(draft)}
            >
              Crear
            </button>
            <button type="button" className="btn" onClick={() => setDraft(null)}>
              Descartar
            </button>
          </div>
        </>
      )}
    </details>
  );
}
