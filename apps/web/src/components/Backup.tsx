import { useRef, useState } from "react";
import { backupMadeAt, exportJson, parseBackup } from "../backup.js";
import { localParts } from "../engine.js";
import { forgetImport, rememberImport } from "../importUndo.js";
import { type AppData, CRITICAL } from "../model.js";
import { standingCheckIns, withOrphanMarks } from "../planning.js";
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
 * What an import makes of the file over the current copy: the file's data, plus the check-ins
 * made after the backup (as long as their task is in it) and the units they declare that the
 * file does not have (added after the backup, taken from the current copy). The parts need no
 * care here: `refresh` settles them as the hand marks of the file plus what the records that
 * stand declare, so a part a later correction took back stays open.
 */
export function importCandidate(file: AppData, current: AppData): AppData {
  // Check-ins are an append-only log: the ones made after the backup stay.
  const inBackup = new Set(file.tasks.map((t) => t.id));
  const inFile = new Set(file.checkIns.map((c) => c.id));
  const newer = current.checkIns.filter((c) => inBackup.has(c.taskId) && !inFile.has(c.id));
  const standing = new Set(
    standingCheckIns({ ...file, checkIns: [...file.checkIns, ...newer] }).map((c) => c.id),
  );
  const tasks = file.tasks.map((t) => {
    const declared = new Set(
      newer.filter((c) => c.taskId === t.id && standing.has(c.id)).flatMap((c) => c.unitIds),
    );
    const mine = current.tasks.find((x) => x.id === t.id);
    const added = (mine?.units ?? [])
      .filter((u) => declared.has(u.id) && !t.units.some((x) => x.id === u.id))
      .map(({ doneAt: _d, doneByHand: _h, ...u }) => u);
    return added.length ? { ...t, units: [...t.units, ...added] } : t;
  });
  // A part the file marks as declared by a record that neither the file nor the newer records
  // have is read as marked by hand; one that a newer record declares is not an orphan.
  const merged = { ...file, tasks, checkIns: [...file.checkIns, ...newer] };
  return { ...merged, tasks: withOrphanMarks({ ...file, tasks }, merged).tasks };
}

/** «del 20/11» (and the year when it is not this one): the day a backup was made. */
export function backupDay(tz: string, at: number, now: number): string {
  const [y, m, d] = localParts(tz, at).date.split("-").map(Number);
  const year = localParts(tz, now).date.slice(0, 4);
  return `${d}/${m}${String(y) === year ? "" : `/${y}`}`;
}

/** «Importé 12 tareas y 40 eventos del 20/11»: what the file brought, and from when. */
export function importedText(data: AppData, day: string | null): string {
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const things = `${n(data.tasks.length, "tarea", "tareas")} y ${n(data.events.length, "evento", "eventos")}`;
  return `Importé ${things}${day ? ` del ${day}` : ""}`;
}

/** Download everything as JSON, or replace everything with a downloaded file. */
export function Backup() {
  const { data, now, dispatch } = useStore();
  const file = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const toast = useToast();

  const download = () => {
    downloadJson(data, now);
    toast.show("Respaldo exportado");
  };

  const restore = async (f: File) => {
    // With an account a file from elsewhere (another account, the demo) gets new ids.
    const text = await f.text();
    const parsed = parseBackup(text, { account: data.owner });
    if ("error" in parsed) {
      setMessage({ text: parsed.error, error: true });
      return;
    }
    // The file may come from another account: the data is this account's now (and the
    // ids of what the import makes are seeded by its owner).
    const { owner: _theirs, ...theirs } = importCandidate(parsed.data, data);
    const candidate = {
      ...theirs,
      ...(data.owner !== undefined ? { owner: data.owner } : {}),
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
    // The header's «Deshacer» says «importar» too, until something else is changed.
    rememberImport(before, restored);
    setMessage(null);
    const left = parsed.dropped?.length ? `. Quedó afuera: ${parsed.dropped.join(", ")}` : "";
    const madeAt = backupMadeAt(text);
    const day = madeAt === null ? null : backupDay(data.settings.timezone, madeAt, now);
    toast.show(`${importedText(restored, day)}${left}`, {
      undo: () => {
        forgetImport();
        dispatch({ type: "replace", data: before });
      },
    });
  };

  return (
    <>
      <p className="meta">
        Guardá una copia de tus datos para recuperarlos o pasarlos a otro dispositivo.
      </p>
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
