import { useState } from "react";
import { dayAndTime, hours } from "../format";
import type { AppTask } from "../model";
import { progress, refreshPlan } from "../planning";
import { useStore } from "../store";
import { TaskDetail } from "./TaskDetail";
import { TaskEditor } from "./TaskEditor";

export function Silos() {
  const { data, now } = useStore();
  const tz = data.settings.timezone;
  const [editing, setEditing] = useState<AppTask | "new" | null>(null);
  const [detail, setDetail] = useState<AppTask | null>(null);
  const levels = new Map(refreshPlan(data, now).result.status.map((s) => [s.taskId, s.level]));
  const items = progress(data, now).sort((a, b) => a.deadline - b.deadline);

  return (
    <div className="screen">
      <div className="header">
        <h1>Lo que falta</h1>
      </div>
      <div className="scroll">
        <div className="silos">
          {items.map((p) => {
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
                  <span className={`total${ratio > 0.85 ? " on-fill" : ""}`}>
                    {hours(p.totalMinutes)}
                  </span>
                  <div className="fill" style={{ height: `${ratio * 100}%` }} />
                  {p.remainingMinutes > 0 && (
                    <span className="left">{hours(p.remainingMinutes)}</span>
                  )}
                </div>
                <span className="name">{p.task.title}</span>
                <span className="due">
                  {p.task.kind === "habit" ? "esta semana" : dayAndTime(tz, p.deadline)}
                </span>
              </button>
            );
          })}
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
