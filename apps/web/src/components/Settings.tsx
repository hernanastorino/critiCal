import { localParts } from "@critical/engine";
import { useState } from "react";
import { hhmmToMinutes, minutesToHhmm } from "../format";
import { useStore } from "../store";
import { Calendars } from "./Calendars";

export function Settings({
  onClose,
  onReset,
  onSignOut,
}: {
  onClose: () => void;
  onReset?: () => void;
  onSignOut?: () => void;
}) {
  const { data, now, dispatch } = useStore();
  const tz = data.settings.timezone;
  const today = localParts(tz, now).date;
  const override = data.overrides.find((o) => o.date === today);
  const base = data.settings.week[localParts(tz, now).weekday];
  const [wake, setWake] = useState(minutesToHhmm(override?.wake ?? base?.wake ?? 480));
  const [bed, setBed] = useState(minutesToHhmm(override?.bed ?? base?.bed ?? 0));

  return (
    <>
      <button type="button" className="scrim dim" aria-label="Cerrar" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Ajustes">
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
              override: { date: today, wake: hhmmToMinutes(wake), bed: hhmmToMinutes(bed) },
            });
            onClose();
          }}
        >
          Reacomodar hoy
        </button>

        <Calendars />

        <div className="section-title">Cuenta</div>
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
