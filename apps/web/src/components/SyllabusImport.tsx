import { useRef, useState } from "react";
import { useSync } from "../Connected.js";
import { zonedInstant } from "../engine.js";
import { dateYearInRange, deadlineInRange } from "../limits.js";
import { newId, nextColor } from "../model.js";
import { readSyllabus } from "../remote.js";
import { useStore } from "../store.js";
import { editedHours, type PlannedAssessment, type Syllabus, syllabusTasks } from "../syllabus.js";
import { ErrorNote, Wait } from "./Feedback.js";
import { Section } from "./Section.js";

const MAX_BYTES = 3_000_000;

const ERRORS: Record<string, string> = {
  server_not_configured:
    "Falta la clave de Gemini en el servidor. Cargá la tuya en «Tu IA (Gemini)» y volvé a elegir el PDF.",
  too_large: "El PDF es muy grande (máximo 3 MB).",
  gemini_busy: "Gemini está saturado o sin cuota gratis por hoy.",
  model_unavailable:
    "El modelo configurado en GEMINI_MODEL no existe: hay que corregirlo en Vercel.",
  unreadable: "No pude entender el programa. ¿Es el PDF correcto?",
  unreachable: "Sin conexión: no se pudo leer el programa.",
};

/** Errors where the same file may work on a second try; for the rest another file is the fix. */
const RETRY = new Set(["gemini_busy", "unreachable", "read_failed", "other"]);

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
  const { data, now, dispatch } = useStore();
  /** A date the plan can use: present and in a sane range (not year 9999). */
  const usable = (date: string) => {
    // By the date as written: 1/1 of the year after the limit is out, in any zone.
    if (!dateYearInRange(date, now)) return false;
    try {
      return deadlineInRange(zonedInstant(data.settings.timezone, date, 12 * 60), now);
    } catch {
      // Beyond what a JavaScript date can hold (year 275760): not a date the plan can use.
      return false;
    }
  };
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<{ text: string; kind: string } | null>(null);
  const last = useRef<File | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (!sync) return null;

  const read = async (file: File) => {
    setError(null);
    setDone(null);
    last.current = file;
    if (file.size > MAX_BYTES) {
      setError({ text: ERRORS.too_large ?? "", kind: "too_large" });
      return;
    }
    setBusy(true);
    setStage(0);
    let r: Awaited<ReturnType<typeof readSyllabus>>;
    try {
      const pdf = await toBase64(file);
      setStage(1);
      r = await readSyllabus(sync.client, pdf);
    } catch {
      setError({
        text: "No se pudo abrir el archivo PDF en este dispositivo.",
        kind: "read_failed",
      });
      return;
    } finally {
      setBusy(false);
    }
    if (!r.ok) {
      setError({
        text: ERRORS[r.error] ?? "No se pudo leer el programa.",
        kind: ERRORS[r.error] ? r.error : "other",
      });
      return;
    }
    setDraft(draftOf(r.syllabus));
  };

  const confirm = (d: Draft) => {
    const hours = new Map(d.units.filter((u) => u.keep).map((u) => [u.title, u.hours]));
    const assessments: PlannedAssessment[] = d.assessments
      .filter((a) => a.keep && usable(a.date))
      .map((a) => ({
        title: a.title.trim() || "Evaluación",
        kind: a.kind,
        date: a.date,
        units: a.units
          .filter((t) => hours.has(t))
          .map((t) => ({ title: t, minutes: (hours.get(t) ?? 0) * 60, weight: a.weights?.[t] })),
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
    <Section>
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
            ref={picker}
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void read(f);
            }}
          />
        </label>
      )}
      {busy && (
        <Wait
          label={stage === 0 ? "Preparando el PDF" : "Leyendo el programa"}
          done={stage}
          total={2}
        />
      )}
      {error && (
        <ErrorNote
          action={
            RETRY.has(error.kind) && last.current
              ? { label: "Probar de nuevo", onClick: () => last.current && void read(last.current) }
              : error.kind === "server_not_configured" || error.kind === "model_unavailable"
                ? undefined
                : { label: "Elegir otro PDF", onClick: () => picker.current?.click() }
          }
        >
          {error.text}
        </ErrorNote>
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
                {a.keep && !a.date ? " · falta la fecha" : ""}
                {a.keep && a.date && !usable(a.date) ? " · revisá la fecha" : ""}
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
              disabled={!draft.assessments.some((a) => a.keep && usable(a.date))}
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
    </Section>
  );
}
