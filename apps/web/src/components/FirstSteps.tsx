import { type Dispatch, useState } from "react";
import { useSync } from "../Connected.js";
import { useStore } from "../store.js";
import { Marks } from "./icons.js";
import type { PageId } from "./Settings.js";

/** This device's state of the guide: put away («Saltar») or gone through. */
export const FIRST_STEPS_KEY = "critical.firstSteps";

const readKey = (): string | null => {
  try {
    return localStorage.getItem(FIRST_STEPS_KEY);
  } catch {
    return null;
  }
};
const writeKey = (v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(FIRST_STEPS_KEY);
    else localStorage.setItem(FIRST_STEPS_KEY, v);
  } catch {
    // Private mode: the guide just shows again next time.
  }
};

/** «Primeros pasos» in Ajustes: the guide comes back on the week. */
export const resumeFirstSteps = () => {
  writeKey(null);
};

/**
 * The first-use guide (SPEC §14 «Primer uso guiado»): connect Google → the first materia or
 * entrega → the first plan, with its progress in sight. Connecting counts as a step done
 * (SPEC §18.1, goal gradient). Only with an account (the demo has everything already); it
 * can be skipped and resumed from Ajustes.
 */
export function FirstSteps({ onSettings }: { onSettings: Dispatch<PageId> }) {
  const sync = useSync();
  if (!sync) return null;
  return <FirstStepsCard google={!!sync.status.google?.connected} onSettings={onSettings} />;
}

/** The guide itself, for an account whose Google Calendar connection is `google`. */
export function FirstStepsCard({
  google,
  onSettings,
}: {
  google: boolean;
  onSettings: Dispatch<PageId>;
}) {
  const { data } = useStore();
  const [state, setState] = useState(readKey);
  if (state) return null;
  const first = data.tasks.some((t) => t.status === "active");
  const steps = [
    {
      done: google,
      text: "Conectá Google Calendar",
      action: "Conectar Google",
      go: () => {
        onSettings("calendars");
      },
    },
    {
      done: first,
      text: "Cargá tu primera materia o entrega",
      action: "Cargar materias",
      go: () => {
        onSettings("semester");
      },
    },
    {
      done: false,
      text: "Mirá tu primer plan",
      action: "Ver mi plan",
      go: () => {
        writeKey("done");
        setState("done");
      },
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  return (
    <section className="card first-steps" aria-labelledby="first-steps-title">
      <div className="title" id="first-steps-title">
        Primeros pasos · {doneCount} de {steps.length}
      </div>
      <div
        className="first-steps-bar"
        role="progressbar"
        aria-label="Primeros pasos"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={doneCount}
      >
        <div style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
      <ol className="first-steps-list">
        {steps.map((s) => (
          <li key={s.text} className={s.done ? "done" : undefined}>
            {s.done ? <Marks.done /> : <span className="first-steps-dot" aria-hidden="true" />}
            <span>
              {s.text}
              {s.done && <span className="sr-only"> (hecho)</span>}
            </span>
          </li>
        ))}
      </ol>
      <div className="row">
        <button
          type="button"
          className="btn"
          onClick={() => {
            writeKey("skipped");
            setState("skipped");
          }}
        >
          Saltar por ahora
        </button>
        {next && (
          <button type="button" className="btn primary" onClick={next.go}>
            {next.action}
          </button>
        )}
      </div>
    </section>
  );
}
