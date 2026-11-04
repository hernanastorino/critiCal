import { useRef, useState } from "react";
import { exportJson, parseBackup } from "../backup.js";
import { localParts } from "../engine.js";
import { CRITICAL } from "../model.js";
import { useStore } from "../store.js";

/** Download everything as JSON, or replace everything with a downloaded file. */
export function Backup() {
  const { data, now, dispatch } = useStore();
  const file = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const download = () => {
    const blob = new Blob([exportJson(data, now)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `critical-${localParts(data.settings.timezone, now).date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const restore = async (f: File) => {
    const parsed = parseBackup(await f.text());
    if ("error" in parsed) {
      setMessage({ text: parsed.error, error: true });
      return;
    }
    if (!window.confirm("Esto reemplaza todos tus datos por los del archivo. ¿Seguir?")) return;
    // Check-ins are an append-only log: the ones made after the backup stay, as long as
    // their task is in it.
    const tasks = new Set(parsed.data.tasks.map((t) => t.id));
    const inFile = new Set(parsed.data.checkIns.map((c) => c.id));
    const newer = data.checkIns.filter((c) => tasks.has(c.taskId) && !inFile.has(c.id));
    // Units those check-ins completed stay completed, including units added after the
    // backup (taken from the current copy of the task).
    const restored = parsed.data.tasks.map((t) => {
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
    dispatch({
      type: "replace",
      data: { ...parsed.data, tasks: restored, checkIns: [...parsed.data.checkIns, ...newer] },
    });
    setMessage({ text: "Datos importados ✓" });
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
      {message && (
        <p className="meta" style={message.error ? { color: CRITICAL } : undefined}>
          {message.text}
        </p>
      )}
    </>
  );
}
