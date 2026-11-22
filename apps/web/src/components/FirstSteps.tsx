import { type Dispatch, useSyncExternalStore } from "react";
import { useSync } from "../Connected.js";
import { isTestDemo } from "../demoPruebas.js";
import { useStore } from "../store.js";
import { Marks } from "./icons.js";
import type { PageId } from "./Settings.js";

/**
 * This device's state of the guide: put away («Saltar») or gone through. Kept per account
 * (`owner`): a new account on a used device starts the guide again.
 */
export const FIRST_STEPS_KEY = "critical.firstSteps";
const keyFor = (owner?: string) => (owner ? `${FIRST_STEPS_KEY}.${owner}` : FIRST_STEPS_KEY);

const readKey = (owner?: string): string | null => {
  try {
    return localStorage.getItem(keyFor(owner));
  } catch {
    return memory.get(keyFor(owner)) ?? null;
  }
};
/** Where the state lives when the browser blocks storage (until the page closes). */
const memory = new Map<string, string>();
const listeners = new Set<() => void>();
const writeKey = (owner: string | undefined, v: string | null) => {
  const k = keyFor(owner);
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    if (v === null) memory.delete(k);
    else memory.set(k, v);
  }
  // The card on the week is already mounted: it hears about it now, not on the next visit.
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** «Primeros pasos» in Ajustes: the guide comes back on the week, right away. */
export const resumeFirstSteps = (owner?: string) => {
  writeKey(owner, null);
};

/**
 * The first-use guide (SPEC §14 «Primer uso guiado»): connect Google → the first materia or
 * entrega → the first plan, with its progress in sight. Connecting counts as a step done
 * (SPEC §18.1, goal gradient). Only with an account (the demo has everything already); it
 * can be skipped and resumed from Ajustes.
 */
export function FirstSteps({ onSettings }: { onSettings: Dispatch<PageId> }) {
  const sync = useSync();
  // The demo has everything already; only the test demo shows the guide, to try it.
  if (!sync) return isTestDemo() ? <FirstStepsCard google={false} onSettings={onSettings} /> : null;
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
  const owner = data.owner;
  const state = useSyncExternalStore(
    subscribe,
    () => readKey(owner),
    () => null,
  );
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
        writeKey(owner, "done");
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
            writeKey(owner, "skipped");
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
