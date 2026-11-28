import { describe, expect, it } from "vitest";
import { exportJson, parseBackup } from "../src/backup.js";
import { eventRow, saveEvents } from "../src/backupSave.js";
import { eventOf } from "../src/data.js";
import { emptyData, TIMEZONE } from "../src/demo.js";
import type { AppEvent } from "../src/model.js";
import { dbClient } from "../src/testingDb.js";
import { toRow } from "./_lib/google.js";

// Sin duplicados al reconectar el calendario (SPEC §18 punto 20): el respaldo guarda los
// eventos con la clave que usa la sincronización (`source` + `external_id`), así que la
// sincronización los encuentra y los actualiza en vez de hacer copias.

const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 30, 12);

const google = (id: string, title: string, start: number): AppEvent => ({
  id: `google:work|${id}`,
  title,
  start,
  end: start + HOUR,
  busy: true,
  source: "google",
  calendarId: "google:work",
  link: "https://calendar.google.com/e",
});
const icloud: AppEvent = {
  id: "icloud:https://caldav.icloud.com/p/|uid-1|2026-12-02",
  title: "Cumple",
  start: T0 + 2 * HOUR,
  end: T0 + 3 * HOUR,
  busy: false,
  tentative: true,
  allDay: false,
  source: "icloud",
  calendarId: "icloud:https://caldav.icloud.com/p/",
};
const events = [google("e1", "Clase", T0), google("e2", "Parcial", T0 + 24 * HOUR), icloud];

describe("eventos de un respaldo y la sincronización del calendario", () => {
  it("la fila de un evento se lee de vuelta como el mismo evento", () => {
    for (const e of events) {
      expect(eventOf(eventRow(e))).toMatchObject({
        id: e.id,
        title: e.title,
        start: e.start,
        end: e.end,
        busy: e.busy,
        source: e.source,
        calendarId: e.calendarId,
      });
    }
  });

  it("el respaldo conserva el id de origen al cargarlo en otra cuenta", () => {
    const file = exportJson({ ...emptyData(), events }, T0);
    const parsed = parseBackup(file, { account: B });
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.data.events.map((e) => e.id)).toEqual(events.map((e) => e.id));
    expect(parsed.data.events.map((e) => e.calendarId)).toEqual(events.map((e) => e.calendarId));
  });

  it("sincronizar Google después actualiza esas filas por su id de origen, sin copias", async () => {
    const db = dbClient(B);
    expect(await saveEvents(db.client, events)).toBe(true);
    const keys = () =>
      db
        .rows("calendar_events")
        .map((r) => `${r.source}|${r.external_id}`)
        .sort();
    const before = keys();
    expect(before).toHaveLength(3);
    // Lo que escribe la sincronización: la misma clave que el evento del respaldo.
    const rows = events
      .filter((e) => e.source === "google")
      .map((e) =>
        toRow(
          B,
          "work",
          {
            id: e.id.replace("google:work|", ""),
            summary: `${e.title} (calendario)`,
            start: { dateTime: new Date(e.start).toISOString() },
            end: { dateTime: new Date(e.end).toISOString() },
          },
          TIMEZONE,
        ),
      );
    await db.client.from("calendar_events").upsert(rows.filter((r) => r !== null));
    expect(keys()).toEqual(before);
    const synced = db
      .rows("calendar_events")
      .filter((r) => String(r.title).endsWith("(calendario)"));
    expect(synced).toHaveLength(2);
    // Cargar el mismo respaldo otra vez tampoco duplica.
    await saveEvents(db.client, events);
    expect(keys()).toEqual(before);
  });

  it("los eventos de la demo no son filas (la tabla solo conoce Google e iCloud)", async () => {
    const db = dbClient(B);
    const demo: AppEvent = { ...google("d", "Demo", T0), id: "d", source: "demo" };
    await saveEvents(db.client, [demo, icloud]);
    expect(db.rows("calendar_events")).toHaveLength(1);
  });
});
