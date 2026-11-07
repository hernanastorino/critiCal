import { useRef, useState } from "react";
import { useSync } from "../Connected.js";
import { widgetToken } from "../remote.js";
import { widgetScript } from "../widget-script.js";
import { ErrorNote, reloadAction, SESSION_EXPIRED, TIMED_OUT, Wait } from "./Feedback.js";
import { Section } from "./Section.js";
import { useToast } from "./Toast.js";

/** Scriptable widget: a personal token and the script to paste in Scriptable. */
export function WidgetSetup() {
  const sync = useSync();
  const [script, setScript] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "error" | "revoked">("idle");
  // What was being done: the wait and the error name it.
  const [why, setWhy] = useState<string | undefined>();
  const [doing, setDoing] = useState<"create" | "revoke" | "copy">("create");
  const toast = useToast();
  // One token request at a time: a revoke racing a create could leave either outcome.
  const inFlight = useRef(false);
  if (!sync) return null;

  const run = async (action: "create" | "revoke") => {
    if (inFlight.current) return;
    inFlight.current = true;
    setDoing(action);
    setState("busy");
    try {
      const r = await widgetToken(sync.client, action);
      if (!r.ok || (action === "create" && !r.token)) {
        // A failed revoke leaves the token valid: keep the script so the user can retry.
        setWhy(r.error);
        setState("error");
        return;
      }
      if (action === "create") {
        setScript(widgetScript(window.location.origin, r.token as string));
        setState("idle");
      } else {
        setScript(null);
        setState("revoked");
        toast.show("Widget desactivado");
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
                  .then(() => {
                    setState("idle");
                    toast.show("Script copiado");
                  })
                  .catch(() => {
                    setDoing("copy");
                    setWhy(undefined);
                    setState("error");
                  })
              }
            >
              Copiar script
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
      {state === "busy" && (
        <Wait label={doing === "revoke" ? "Desactivando el widget" : "Generando el script"} />
      )}
      {state === "error" && (
        <ErrorNote
          action={
            why === "unauthorized"
              ? reloadAction
              : doing === "copy"
                ? {
                    label: "Seleccionar el script",
                    onClick: () => {
                      document.querySelector<HTMLTextAreaElement>("textarea[readonly]")?.select();
                      setState("idle");
                    },
                  }
                : { label: "Probar de nuevo", onClick: () => void run(doing) }
          }
        >
          {why === "unauthorized"
            ? SESSION_EXPIRED
            : why === "timeout"
              ? TIMED_OUT
              : doing === "copy"
                ? "No se pudo copiar el script."
                : doing === "revoke"
                  ? "No se pudo desactivar el widget: sigue funcionando."
                  : "No se pudo generar el script."}
        </ErrorNote>
      )}
    </Section>
  );
}
