import { useState } from "react";
import { useSync } from "../Connected.js";
import { CRITICAL } from "../model.js";
import { widgetToken } from "../remote.js";
import { widgetScript } from "../widget-script.js";

/** Scriptable widget: a personal token and the script to paste in Scriptable. */
export function WidgetSetup() {
  const sync = useSync();
  const [script, setScript] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "copied" | "error" | "revoked">("idle");
  if (!sync) return null;

  const create = async () => {
    setState("busy");
    const r = await widgetToken(sync.client, "create");
    if (!r.ok || !r.token) {
      setState("error");
      return;
    }
    setScript(widgetScript(window.location.origin, r.token));
    setState("idle");
  };

  return (
    <details className="card prefs">
      <summary className="title">Widget de silos (Scriptable)</summary>
      <p className="meta">
        Instalá Scriptable (gratis), creá un script nuevo y pegá el código. Después agregá un widget
        de Scriptable en la pantalla de inicio y elegí ese script. Generar un código nuevo invalida
        el anterior.
      </p>
      {script ? (
        <>
          <textarea
            readOnly
            value={script}
            rows={6}
            aria-label="Script del widget"
            style={{ width: "100%", fontFamily: "monospace", fontSize: 11 }}
          />
          <div className="row">
            <button
              type="button"
              className="btn primary"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(script)
                  .then(() => setState("copied"))
                  .catch(() => setState("error"))
              }
            >
              {state === "copied" ? "Copiado ✓" : "Copiar script"}
            </button>
            <button
              type="button"
              className="btn"
              onClick={async () => {
                await widgetToken(sync.client, "revoke");
                setScript(null);
                setState("revoked");
              }}
            >
              Desactivar
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          className="btn"
          style={{ width: "100%" }}
          disabled={state === "busy"}
          onClick={() => void create()}
        >
          Generar script
        </button>
      )}
      {state === "error" && (
        <p className="meta" style={{ color: CRITICAL }}>
          No se pudo. Probá de nuevo.
        </p>
      )}
      {state === "revoked" && <p className="meta">Widget desactivado ✓</p>}
    </details>
  );
}
