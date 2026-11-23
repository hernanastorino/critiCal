import { useEffect, useRef, useState } from "react";
import { clipName, dayDate, dueDate, hours } from "../format.js";
import type { AppTask } from "../model.js";
import {
  focusWeekAt,
  isRunning,
  progress,
  refreshPlan,
  semesterLabel,
  shownTotal,
  splitPastSilos,
  type TaskProgress,
} from "../planning.js";
import { useStore } from "../store.js";
import { plannedVsDone } from "../week-review.js";
import { CountUp } from "./CountUp.js";
import { TaskDetail } from "./TaskDetail.js";
import { editorDraft, TaskEditor } from "./TaskEditor.js";
import { useToast } from "./Toast.js";

let pastOpen = false;

export function Silos() {
  const { data, now, dispatch } = useStore();
  const tz = data.settings.timezone;
  const [showArchived, setShowArchived] = useState(false);
  // Only the ones whose materia still exists: recovering a task of a deleted one would lead nowhere.
  const archived = data.tasks.filter(
    (t) => t.status === "dropped" && data.activities.some((a) => a.id === t.activityId),
  );
  // A reload brings back the editor that was open, with what was typed.
  const [editing, setEditing] = useState<AppTask | "new" | null>(() => {
    const d = editorDraft("silos");
    if (!d) return null;
    return d.taskId === null ? "new" : (data.tasks.find((t) => t.id === d.taskId) ?? null);
  });
  const [detail, setDetail] = useState<AppTask | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const toast = useToast();
  // Remembered while the app is open, so a trip to another tab does not close it.
  const [showPast, setShowPastState] = useState(pastOpen);
  const setShowPast = (open: boolean) => {
    pastOpen = open;
    setShowPastState(open);
  };
  // Routines (Gym, etc.) live in Ajustes → Rutinas: they are not silos to empty.
  const isRoutine = (t: AppTask) =>
    data.activities.find((a) => a.id === t.activityId)?.kind === "rutina";
  const levels = new Map(refreshPlan(data, now).result.status.map((s) => [s.taskId, s.level]));
  const { current: items, past } = splitPastSilos(
    progress(data, now, focusWeekAt(data, now))
      .filter((p) => !isRoutine(p.task))
      .sort((a, b) => a.deadline - b.deadline),
    tz,
    focusWeekAt(data, now),
  );
  // A task just saved with an old date leaves the view: say where it went.
  const pastIds = past.map((p) => p.task.id).join(" ");
  const seenPast = useRef<string | null>(null);
  useEffect(() => {
    const before = seenPast.current;
    seenPast.current = pastIds;
    if (before === null || showPast) return;
    const was = new Set(before.split(" "));
    const moved = past.find((p) => !was.has(p.task.id));
    if (moved) toast.show(`${clipName(moved.task.title)} pasó a «Ver anteriores»`);
  }, [pastIds, past, showPast, toast]);
  const pastGroups = new Map<string, TaskProgress[]>();
  for (const p of past) {
    const label = semesterLabel(tz, p.deadline);
    pastGroups.set(label, [...(pastGroups.get(label) ?? []), p]);
  }

  const silo = (p: TaskProgress) => {
    const color = data.activities.find((a) => a.id === p.task.activityId)?.color ?? "#888";
    const total = shownTotal(p);
    const ratio = total > 0 ? Math.min(1, p.remainingMinutes / total) : 0;
    const level = levels.get(p.task.id) ?? "ok";
    // Once next week is planned, a routine's silo counts that one.
    const due =
      p.task.kind === "habit"
        ? focusWeekAt(data, now) === now
          ? "esta semana"
          : "la semana próxima"
        : dueDate(tz, p.deadline, now);
    const overdue = p.task.kind !== "habit" && p.deadline <= now && p.remainingMinutes > 0;
    return (
      <button
        type="button"
        key={p.task.id}
        data-task={p.task.id}
        className="silo"
        aria-label={`${p.task.title}: faltan ${hours(p.remainingMinutes)}, ${p.task.kind === "habit" ? due : `${overdue ? "venció el" : "entrega"} ${due}`}`}
        onClick={() => setDetail(p.task)}
      >
        <div className={`tank ${level}`} style={{ ["--c" as string]: color }}>
          <span className={`total${ratio > 0.85 ? " on-fill" : ""}`}>
            <CountUp value={total} />
          </span>
          <div className="fill" style={{ height: `${ratio * 100}%` }} />
          {p.remainingMinutes > 0 && (
            <span className="left">
              <CountUp value={p.remainingMinutes} />
            </span>
          )}
        </div>
        <span className="name">{p.task.title}</span>
        <span className={`due${overdue ? " overdue" : ""}`}>
          {overdue ? `Venció · ${due}` : due}
        </span>
      </button>
    );
  };
  // Weekly silos switched off (this week or until resumed), shown faded.
  const off = data.tasks.filter(
    (t) => t.status === "active" && !isRunning(t, now) && !isRoutine(t),
  );
  const week = plannedVsDone(data, now).filter((r) => r.planned > 0 || r.done > 0);

  return (
    <div className="screen">
      <div className="header">
        <h1 ref={titleRef} tabIndex={-1}>
          Lo que falta
        </h1>
      </div>
      <div className="scroll">
        {items.length === 0 && off.length === 0 && (
          // An empty screen says what goes here and where to start (SPEC §14).
          <p className="empty">
            Acá van tus entregas y parciales: cada silo muestra cuánto te falta. Creá la primera con
            «Nueva».
          </p>
        )}
        <div className="silos">
          {items.map(silo)}
          {off.map((t) => (
            <button
              type="button"
              key={t.id}
              data-task={t.id}
              className="silo off"
              aria-label={`${t.title}: desactivado`}
              onClick={() => setDetail(t)}
            >
              <div
                className="tank"
                style={{
                  ["--c" as string]:
                    data.activities.find((a) => a.id === t.activityId)?.color ?? "#888",
                }}
              />
              <span className="name">{t.title}</span>
              <span className="due">
                {t.paused ? "pausado" : `vuelve el ${dayDate(tz, t.skipUntil ?? now)}`}
              </span>
            </button>
          ))}
          <button
            type="button"
            className="silo"
            onClick={() => setEditing("new")}
            aria-label="Nueva actividad"
          >
            <div className="add-tank">+</div>
            <span className="name">Nueva</span>
          </button>
        </div>
        {past.length > 0 && (
          <>
            <button
              type="button"
              className="btn past-toggle"
              aria-expanded={showPast}
              onClick={() => setShowPast(!showPast)}
            >
              {showPast ? "Ocultar anteriores" : `Ver anteriores (${past.length})`}
            </button>
            {showPast &&
              [...pastGroups].map(([label, group]) => (
                <section key={label} className="past-silos" aria-label={label}>
                  <h2>{label}</h2>
                  <div className="silos">{group.map(silo)}</div>
                </section>
              ))}
          </>
        )}
        {archived.length > 0 && (
          <>
            <button
              type="button"
              className="btn past-toggle"
              aria-expanded={showArchived}
              onClick={() => setShowArchived(!showArchived)}
            >
              {showArchived ? "Ocultar archivadas" : `Ver archivadas (${archived.length})`}
            </button>
            {showArchived && (
              <section className="card" aria-label="Archivadas">
                {archived.map((t) => (
                  <div key={t.id} className="row">
                    <span style={{ flex: 1 }}>
                      {t.title}
                      {t.kind !== "habit" && t.deadline !== undefined && (
                        <span className="meta" style={{ display: "block" }}>
                          {t.deadline <= now ? "Venció el" : "Entrega"}{" "}
                          {dueDate(tz, t.deadline, now)}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="btn small"
                      aria-label={`Recuperar ${t.title}`}
                      onClick={() => {
                        dispatch({ type: "unarchive", taskId: t.id, status: "active" });
                        toast.show(`${clipName(t.title)} recuperada`);
                      }}
                    >
                      Recuperar
                    </button>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
        {week.length > 0 && (
          <div className="card">
            <div className="title">Esta semana: planificado vs. hecho</div>
            <div className="pvd">
              {week.map((r) => (
                <div key={r.taskId} style={{ display: "contents" }}>
                  <span>
                    {r.title}
                    {r.routine && <span className="meta"> · rutina</span>}
                  </span>
                  <span className="meta" style={{ margin: 0 }}>
                    <CountUp value={r.done} /> de <CountUp value={r.planned} />
                  </span>
                  <div className="track" style={{ ["--c" as string]: r.color }}>
                    <div
                      style={{
                        width: `${r.planned > 0 ? Math.min(100, (r.done / r.planned) * 100) : 100}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {detail && (
        <TaskDetail
          task={detail}
          onClose={() => setDetail(null)}
          onGone={() => titleRef.current?.focus()}
          onEdit={() => {
            setEditing(detail);
            setDetail(null);
          }}
        />
      )}
      {editing && (
        <TaskEditor
          origin="silos"
          task={editing === "new" ? undefined : editing}
          onClose={() => {
            const id = editing === "new" ? undefined : editing.id;
            setEditing(null);
            // A new date may move it to (or out of) «anteriores»: focus follows it, or
            // goes to the title when it is now hidden.
            requestAnimationFrame(() => {
              if (document.activeElement && document.activeElement !== document.body) return;
              const moved =
                id && document.querySelector<HTMLElement>(`[data-task="${CSS.escape(id)}"]`);
              (moved || titleRef.current)?.focus();
            });
          }}
        />
      )}
    </div>
  );
}
