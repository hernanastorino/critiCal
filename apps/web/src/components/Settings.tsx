import { useState } from "react";
import { localParts } from "../engine.js";
import { hhmmToMinutes, minutesToHhmm } from "../format.js";
import { holidaysBetween } from "../holidays.js";
import { useStore } from "../store.js";
import { Backup } from "./Backup.js";
import { Calendars } from "./Calendars.js";
import { Notifications } from "./Notifications.js";
import { Places } from "./Places.js";
import {
  ActivitySettings,
  DetectedDefaults,
  Routines,
  RuleSettings,
  WeekSettings,
} from "./Preferences.js";
import { Semester } from "./Semester.js";
import { SyllabusImport } from "./SyllabusImport.js";
import { Invites } from "./Invites.js";
import { WidgetSetup } from "./WidgetSetup.js";

export function Settings({
  onClose,
  onReset,
  onSignOut,
  onWeeklyPlan,
}: {
  onClose: () => void;
  onReset?: () => void;
  onSignOut?: () => void;
  onWeeklyPlan?: () => void;
}) {
  const { data, now, dispatch } = useStore();
  const tz = data.settings.timezone;
  const today = localParts(tz, now).date;
  const override = data.overrides.find((o) => o.date === today);
  // Same routine the planner uses: holidays are Sundays unless turned off.
  const holiday =
    data.preferences?.holidaysOff !== false && holidaysBetween(today, today).length > 0;
  const base =
    data.settings.week[override?.asWeekday ?? (holiday ? 0 : localParts(tz, now).weekday)];
  const defaultWake = minutesToHhmm(override?.wake ?? base?.wake ?? 480);
  const defaultBed = minutesToHhmm(override?.bed ?? base?.bed ?? 0);
  // Untouched fields follow the routine (e.g. holidays switched on or off here).
  const [wakeEdit, setWake] = useState<string | null>(null);
  const [bedEdit, setBed] = useState<string | null>(null);
  const wake = wakeEdit ?? defaultWake;
  const bed = bedEdit ?? defaultBed;

  return (
    <>
      <button type="button" className="scrim dim" aria-label="Cerrar" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Ajustes">
        <button type="button" className="sheet-close" aria-label="Cerrar" onClick={onClose}>
          ✕
        </button>
        <h2>Hoy</h2>
        <p className="meta">
          Si te levantaste o te vas a acostar a otra hora, el día se reacomoda.
        </p>
        <div className="row">
          <label className="field" style={{ flex: 1 }}>
            <span>Me levanté a las</span>
            <input type="time" value={wake} onChange={(e) => setWake(e.target.value)} />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span>Me acuesto a las</span>
            <input type="time" value={bed} onChange={(e) => setBed(e.target.value)} />
          </label>
        </div>
        <button
          type="button"
          className="btn primary"
          style={{ width: "100%" }}
          onClick={() => {
            dispatch({
              type: "override",
              // Keep whatever else today's override says (its routine).
              override: {
                ...override,
                date: today,
                wake: hhmmToMinutes(wake),
                bed: hhmmToMinutes(bed),
              },
            });
            onClose();
          }}
        >
          Reacomodar hoy
        </button>

        {onWeeklyPlan && (
          <button type="button" className="btn" style={{ width: "100%" }} onClick={onWeeklyPlan}>
            Planificación semanal
          </button>
        )}

        <div className="section-title">Configuración fija</div>
        <Semester />
        <Routines />
        <SyllabusImport />
        <WeekSettings />
        <RuleSettings />
        <ActivitySettings />
        <Places />
        <DetectedDefaults />

        <Calendars />
        <Notifications />
        <WidgetSetup />
        <Invites />

        <div className="section-title">Cuenta</div>
        <Backup />
        <div className="row">
          {onReset && (
            <button type="button" className="btn" onClick={onReset}>
              Reiniciar demo
            </button>
          )}
          {onSignOut && (
            <button type="button" className="btn" onClick={onSignOut}>
              Salir
            </button>
          )}
        </div>
      </div>
    </>
  );
}
