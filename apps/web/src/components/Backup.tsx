import { useRef, useState } from "react";
import { exportJson, parseBackup } from "../backup.js";
import { localParts } from "../engine.js";
import { type AppData, type CheckIn, CRITICAL } from "../model.js";
import { standingCheckIns } from "../planning.js";
import { refresh } from "../refresh.js";
import { useStore } from "../store.js";
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

/**
 * The backup's tasks with the units the newer check-ins completed kept completed, including
 * units added after the backup (taken from the current copy of the task). Only the records
 * that stand mark parts: one a later correction replaced, or an undo retired, does not.
 */
export function withNewerUnits(file: AppData, newer: CheckIn[], current: AppData) {
  const kept = new Set(newer.map((c) => c.id));
  const standing = standingCheckIns({ ...file, checkIns: [...file.checkIns, ...newer] }).filter(
    (c) => kept.has(c.id),
  );
  return file.tasks.map((t) => {
    const done = new Map<string, number>();
    for (const c of standing)
      if (c.taskId === t.id) for (const u of c.unitIds) done.set(u, c.createdAt);
    if (done.size === 0) return t;
    const now = current.tasks.find((x) => x.id === t.id);
    const added = (now?.units ?? []).filter(
      (u) => done.has(u.id) && !t.units.some((x) => x.id === u.id),
    );
    const units = [...t.units, ...added].map((u) =>
      done.has(u.id) && !u.doneAt ? { ...u, doneAt: done.get(u.id) } : u,
    );
    return { ...t, units };
  });
}

/** Download everything as JSON, or replace everything with a downloaded file. */
export function Backup() {
  const { data, now, dispatch } = useStore();
  const file = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const toast = useToast();

  const download = () => downloadJson(data, now);

  const restore = async (f: File) => {
    // With an account a file from elsewhere (another account, the demo) gets new ids.
    const parsed = parseBackup(await f.text(), { account: data.owner });
    if ("error" in parsed) {
      setMessage({ text: parsed.error, error: true });
      return;
    }
    // Check-ins are an append-only log: the ones made after the backup stay, as long as
    // their task is in it.
    const inBackup = new Set(parsed.data.tasks.map((t) => t.id));
    const inFile = new Set(parsed.data.checkIns.map((c) => c.id));
    const newer = data.checkIns.filter((c) => inBackup.has(c.taskId) && !inFile.has(c.id));
    const tasks = withNewerUnits(parsed.data, newer, data);
    // The file may come from another account: the data is this account's now (and the
    // ids of what the import makes are seeded by its owner).
    const { owner: _theirs, ...theirs } = parsed.data;
    const candidate = {
      ...theirs,
      ...(data.owner !== undefined ? { owner: data.owner } : {}),
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
    // No question (§14): the data before the import is kept, and «Deshacer» puts it back.
    const before = data;
    dispatch({ type: "replace", data: restored });
    setMessage(null);
    const left = parsed.dropped?.length ? `. Quedó afuera: ${parsed.dropped.join(", ")}` : "";
    toast.show(`Datos importados${left}`, {
      undo: () => dispatch({ type: "replace", data: before }),
    });
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
        <p
          className="meta"
          role={message.error ? "alert" : undefined}
          style={message.error ? { color: CRITICAL } : undefined}
        >
          {message.text}
        </p>
      )}
    </>
  );
}
