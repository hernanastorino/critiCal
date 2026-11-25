import { type Dispatch, useEffect, useState, useSyncExternalStore } from "react";
import { useSync } from "../Connected.js";
import { isTestDemo } from "../demoPruebas.js";
import { useStore } from "../store.js";
import { Marks } from "./icons.js";
import { noteClosed } from "./modal.js";
import { Roy } from "./Roy.js";
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

/** The test demo has no account: tapping «Conectar Google» there counts as connecting it. */
const DEMO_GOOGLE_KEY = "critical.firstSteps.demoGoogle";
const demoGoogle = () => readKey(DEMO_GOOGLE_KEY) === "1";

/**
 * Which steps are done. The plan step needs a plan with a block: the card lives on the week,
 * so having one means the person is looking at it.
 */
export const firstStepsDone = (p: { google: boolean; tasks: boolean; plan: boolean }) => [
  p.google,
  p.tasks,
  p.plan,
];

const STEP_TEXTS = [
  "Conectá Google Calendar",
  "Cargá tu primera materia o entrega",
  "Mirá tu primer plan",
] as const;

/** How long the closing card stays when nobody taps «Listo». */
const CLOSING_MS = 6000;

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
  const demoConnected = useSyncExternalStore(subscribe, demoGoogle, () => false);
  if (!sync) {
    return isTestDemo() ? <FirstStepsCard google={demoConnected} onSettings={onSettings} /> : null;
  }
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
  const first = data.tasks.some((t) => t.status === "active");
  const [google0, tasks0, plan0] = firstStepsDone({
    google,
    tasks: first,
    plan: data.plan.length > 0,
  });
  const all = google0 && tasks0 && plan0;
  // Finished: the closing shows once, then the guide is gone for this account for good.
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (!all || state) return;
    setClosing(true);
    writeKey(owner, "done");
  }, [all, state, owner]);
  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => setClosing(false), CLOSING_MS);
    return () => clearTimeout(t);
  }, [closing]);
  if (closing) {
    return (
      <section className="card first-steps" aria-labelledby="first-steps-title">
        <div className="title" id="first-steps-title">
          Primeros pasos · Listo
        </div>
        <Roy anim="festejo" size={72} once />
        <div className="first-steps-bar" aria-hidden="true">
          <div style={{ width: "100%" }} />
        </div>
        <ol className="first-steps-list">
          {STEP_TEXTS.map((t) => (
            <li key={t} className="done">
              <Marks.done />
              <span>
                {t}
                <span className="sr-only"> (hecho)</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="row">
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              noteClosed();
              setClosing(false);
            }}
          >
            Listo
          </button>
        </div>
      </section>
    );
  }
  if (state) return null;
  const steps = [
    {
      done: google0,
      text: STEP_TEXTS[0],
      action: "Conectar Google",
      go: () => {
        if (!google && isTestDemo()) writeKey(DEMO_GOOGLE_KEY, "1");
        onSettings("calendars");
      },
    },
    {
      done: tasks0,
      text: STEP_TEXTS[1],
      action: "Cargar materias",
      go: () => {
        onSettings("semester");
      },
    },
    {
      done: plan0,
      text: STEP_TEXTS[2],
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
            // The card goes: the second tap of a double tap must not land on the week under it.
            noteClosed();
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
