import { useState } from "react";
import { dayAndTime, dayDate, hours } from "../format.js";
import type { AppTask } from "../model.js";
import {
  isRunning,
  progress,
  refreshPlan,
  semesterLabel,
  splitPastSilos,
  type TaskProgress,
} from "../planning.js";
import { useStore } from "../store.js";
import { plannedVsDone } from "../week-review.js";
import { TaskDetail } from "./TaskDetail.js";
import { TaskEditor } from "./TaskEditor.js";

export function Silos() {
  const { data, now } = useStore();
  const tz = data.settings.timezone;
  const [editing, setEditing] = useState<AppTask | "new" | null>(null);
  const [detail, setDetail] = useState<AppTask | null>(null);
  const [showPast, setShowPast] = useState(false);
  const levels = new Map(refreshPlan(data, now).result.status.map((s) => [s.taskId, s.level]));
  const { current: items, past } = splitPastSilos(
    progress(data, now).sort((a, b) => a.deadline - b.deadline),
    tz,
    now,
  );
  const pastGroups = new Map<string, TaskProgress[]>();
  for (const p of past) {
    const label = semesterLabel(tz, p.deadline);
    pastGroups.set(label, [...(pastGroups.get(label) ?? []), p]);
  }

  const silo = (p: TaskProgress) => {
    const color = data.activities.find((a) => a.id === p.task.activityId)?.color ?? "#888";
    const ratio = p.totalMinutes > 0 ? Math.min(1, p.remainingMinutes / p.totalMinutes) : 0;
    const level = levels.get(p.task.id) ?? "ok";
    return (
      <button
        type="button"
        key={p.task.id}
        className="silo"
        aria-label={`${p.task.title}: faltan ${hours(p.remainingMinutes)}`}
        onClick={() => setDetail(p.task)}
      >
        <div className={`tank ${level}`} style={{ ["--c" as string]: color }}>
          <span className={`total${ratio > 0.85 ? " on-fill" : ""}`}>{hours(p.totalMinutes)}</span>
          <div className="fill" style={{ height: `${ratio * 100}%` }} />
          {p.remainingMinutes > 0 && <span className="left">{hours(p.remainingMinutes)}</span>}
        </div>
        <span className="name">{p.task.title}</span>
        <span className="due">
          {p.task.kind === "habit" ? "esta semana" : dayAndTime(tz, p.deadline)}
        </span>
      </button>
    );
  };
  // Weekly silos switched off (this week or until resumed), shown faded.
  const off = data.tasks.filter((t) => t.status === "active" && !isRunning(t, now));
  const week = plannedVsDone(data, now).filter((r) => r.planned > 0 || r.done > 0);

  return (
    <div className="screen">
      <div className="header">
        <h1>Lo que falta</h1>
      </div>
      <div className="scroll">
        <div className="silos">
          {items.map(silo)}
          {off.map((t) => (
            <button
              type="button"
              key={t.id}
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
        {week.length > 0 && (
          <div className="card">
            <div className="title">Esta semana: planificado vs. hecho</div>
            <div className="pvd">
              {week.map((r) => (
                <div key={r.taskId} style={{ display: "contents" }}>
                  <span>{r.title}</span>
                  <span className="meta" style={{ margin: 0 }}>
                    {hours(r.done)} de {hours(r.planned)}
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
          onEdit={() => {
            setEditing(detail);
            setDetail(null);
          }}
        />
      )}
      {editing && (
        <TaskEditor
          task={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
