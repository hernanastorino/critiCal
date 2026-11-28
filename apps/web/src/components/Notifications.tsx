import { useEffect, useId, useState } from "react";
import { useSync } from "../Connected.js";
import { hhmmToMinutes, minutesToHhmm } from "../format.js";
import { CRITICAL, NOTIFY_DEFAULTS, type NotificationPrefs } from "../model.js";
import { disablePush, enablePush, type PushState, pushState } from "../push.js";
import { useStore } from "../store.js";
import { Section } from "./Section.js";

const STATE_TEXT: Record<Exclude<PushState, "on" | "off">, string> = {
  unsupported: "Este navegador no permite notificaciones.",
  "needs-install":
    "En el iPhone las notificaciones llegan solo a la app instalada: Compartir → Agregar a inicio, y abrila desde ahí.",
  denied: "Las notificaciones están bloqueadas. Activalas en Ajustes → Notificaciones → critiCal.",
};

/** Push notifications: this device's subscription and which ones to send. */
export function Notifications() {
  const sync = useSync();
  const { data, dispatch } = useStore();
  const prefs = { ...NOTIFY_DEFAULTS, ...data.preferences?.notifications };
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const proposalsId = useId();
  const sundayId = useId();

  useEffect(() => {
    pushState()
      .then(setState)
      .catch(() => setState("unsupported"));
  }, []);

  const save = (patch: NotificationPrefs) =>
    dispatch({
      type: "preferences",
      preferences: {
        ...data.preferences,
        notifications: { ...data.preferences?.notifications, ...patch },
      },
    });

  const toggle = async () => {
    if (!sync) return;
    setBusy(true);
    setError(null);
    try {
      setState(state === "on" ? await disablePush(sync.client) : await enablePush(sync.client));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section>
      {!sync ? (
        <p className="meta">Entrá con Google para recibir avisos en este dispositivo.</p>
      ) : state && state !== "on" && state !== "off" ? (
        <p className="meta">{STATE_TEXT[state]}</p>
      ) : (
        <button
          type="button"
          className={`btn${state === "on" ? "" : " primary"}`}
          style={{ width: "100%" }}
          disabled={busy || state === null}
          onClick={() => void toggle()}
        >
          {state === "on" ? "Desactivar en este dispositivo" : "Activar en este dispositivo"}
        </button>
      )}
      {error && (
        <p className="meta" style={{ color: CRITICAL }}>
          {error}
        </p>
      )}
      <div className="check">
        <input
          id="notif-critical"
          type="checkbox"
          checked={!!sync && prefs.critical}
          disabled={!sync}
          onChange={(e) => save({ critical: e.target.checked })}
        />
        <label htmlFor="notif-critical" style={{ flex: 1 }}>
          Antes de cada bloque crítico
        </label>
        <select
          aria-label="Minutos antes"
          disabled={!sync}
          style={{ width: "auto" }}
          value={prefs.leadMinutes}
          onChange={(e) => save({ leadMinutes: Number(e.target.value) })}
        >
          {[5, 10, 15, 30, 60].map((m) => (
            <option key={m} value={m}>
              {m} min antes
            </option>
          ))}
        </select>
      </div>
      <label className="check">
        <input
          type="checkbox"
          aria-labelledby={proposalsId}
          checked={!!sync && prefs.proposals}
          disabled={!sync}
          onChange={(e) => save({ proposals: e.target.checked })}
        />
        <span id={proposalsId} style={{ flex: 1 }}>
          Cuando un evento nuevo cambia el plan de hoy
        </span>
      </label>
      <label className="check">
        <input
          type="checkbox"
          aria-labelledby={sundayId}
          checked={!!sync && prefs.sunday}
          disabled={!sync}
          onChange={(e) => save({ sunday: e.target.checked })}
        />
        <span id={sundayId} style={{ flex: 1 }}>
          Planificación semanal del domingo
        </span>
      </label>
      <div className="check">
        <span style={{ flex: 1 }}>Hora del recordatorio</span>
        <input
          type="time"
          aria-label="Hora del recordatorio"
          disabled={!sync || !prefs.sunday}
          style={{ width: "auto" }}
          value={minutesToHhmm(prefs.sundayAt)}
          onChange={(e) => save({ sundayAt: hhmmToMinutes(e.target.value) })}
        />
      </div>
    </Section>
  );
}
