import { useRef, useState } from "react";
import { useSync } from "../Connected.js";
import { CRITICAL } from "../model.js";
import { widgetToken } from "../remote.js";
import { widgetScript } from "../widget-script.js";
import { Section } from "./Section.js";

/** Scriptable widget: a personal token and the script to paste in Scriptable. */
export function WidgetSetup() {
  const sync = useSync();
  const [script, setScript] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "copied" | "error" | "revoked">("idle");
  // One token request at a time: a revoke racing a create could leave either outcome.
  const inFlight = useRef(false);
  if (!sync) return null;

  const run = async (action: "create" | "revoke") => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState("busy");
    try {
      const r = await widgetToken(sync.client, action);
      if (!r.ok || (action === "create" && !r.token)) {
        // A failed revoke leaves the token valid: keep the script so the user can retry.
        setState("error");
        return;
      }
      if (action === "create") {
        setScript(widgetScript(window.location.origin, r.token as string));
        setState("idle");
      } else {
        setScript(null);
        setState("revoked");
      }
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <Section>
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
          </div>
        </>
      ) : (
        <button
          type="button"
          className="btn"
          style={{ width: "100%" }}
          disabled={state === "busy"}
          onClick={() => void run("create")}
        >
          Generar script
        </button>
      )}
      {/* Always available: after a reload the script is gone but the token may live on. */}
      <button
        type="button"
        className="btn"
        style={{ width: "100%" }}
        disabled={state === "busy"}
        onClick={() => void run("revoke")}
      >
        Desactivar el widget
      </button>
      {state === "error" && (
        <p className="meta" style={{ color: CRITICAL }}>
          No se pudo. Probá de nuevo.
        </p>
      )}
      {state === "revoked" && <p className="meta">Widget desactivado ✓</p>}
    </Section>
  );
}
