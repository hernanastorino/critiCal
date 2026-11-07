import { useRef, useState } from "react";
import { exportJson, parseBackup } from "../backup.js";
import { localParts } from "../engine.js";
import type { AppData } from "../model.js";
import { refresh } from "../refresh.js";
import { useStore } from "../store.js";
import { ErrorNote } from "./Feedback.js";
import { useToast } from "./Toast.js";

/** Saves everything as a JSON file named after today. */
export function downloadJson(data: AppData, now: number) {
  const blob = new Blob([exportJson(data, now)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `critical-${localParts(data.settings.timezone, now).date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Download everything as JSON, or replace everything with a downloaded file. */
export function Backup() {
  const { data, now, dispatch } = useStore();
  const file = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const toast = useToast();

  const download = () => downloadJson(data, now);

  const restore = async (f: File) => {
    const parsed = parseBackup(await f.text());
    if ("error" in parsed) {
      setMessage({
        text: `${parsed.error} Elegí otro archivo, o exportá uno nuevo con «Exportar JSON».`,
        error: true,
      });
      return;
    }
    // Check-ins are an append-only log: the ones made after the backup stay, as long as
    // their task is in it.
    const inBackup = new Set(parsed.data.tasks.map((t) => t.id));
    const inFile = new Set(parsed.data.checkIns.map((c) => c.id));
    const newer = data.checkIns.filter((c) => inBackup.has(c.taskId) && !inFile.has(c.id));
    // Units those check-ins completed stay completed, including units added after the
    // backup (taken from the current copy of the task).
    const tasks = parsed.data.tasks.map((t) => {
      const done = new Map<string, number>();
      for (const c of newer)
        if (c.taskId === t.id) for (const u of c.unitIds) done.set(u, c.createdAt);
      if (done.size === 0) return t;
      const current = data.tasks.find((x) => x.id === t.id);
      const added = (current?.units ?? []).filter(
        (u) => done.has(u.id) && !t.units.some((x) => x.id === u.id),
      );
      const units = [...t.units, ...added].map((u) =>
        done.has(u.id) && !u.doneAt ? { ...u, doneAt: done.get(u.id) } : u,
      );
      return { ...t, units };
    });
    const candidate = {
      ...parsed.data,
      tasks,
      checkIns: [...parsed.data.checkIns, ...newer],
    };
    // A dry run on exactly what will be stored: anything the checks missed fails here,
    // not in the app, and the result itself is what replaces the data.
    let restored: typeof candidate;
    try {
      restored = refresh(candidate, now);
    } catch {
      setMessage({ text: "El respaldo tiene datos que la app no puede usar.", error: true });
      return;
    }
    const known = new Set(restored.tasks.map((t) => t.id));
    const blocks = [
      ...candidate.plan,
      ...restored.plan,
      ...(restored.pins ?? []),
      ...restored.proposals.flatMap((p) => p.plan),
    ];
    if (blocks.some((b) => !known.has(b.taskId))) {
      setMessage({
        text: "El respaldo está incompleto: hay bloques de tareas que no están.",
        error: true,
      });
      return;
    }
    if (!window.confirm("Esto reemplaza todos tus datos por los del archivo. ¿Seguir?")) return;
    dispatch({ type: "replace", data: restored });
    setMessage(null);
    toast.show("Datos importados");
  };

  return (
    <>
      <div className="row">
        <button type="button" className="btn" onClick={download}>
          Exportar JSON
        </button>
        <button type="button" className="btn" onClick={() => file.current?.click()}>
          Importar JSON
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          aria-label="Archivo de respaldo"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void restore(f);
          }}
        />
      </div>
      {message &&
        (message.error ? (
          <ErrorNote
            action={{ label: "Elegir otro archivo", onClick: () => file.current?.click() }}
          >
            {message.text}
          </ErrorNote>
        ) : (
          <p className="meta">{message.text}</p>
        ))}
    </>
  );
}
