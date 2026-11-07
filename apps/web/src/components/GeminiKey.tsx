import { useCallback, useEffect, useRef, useState } from "react";
import { useSync } from "../Connected.js";
import { geminiKey } from "../remote.js";
import { ErrorNote, Skeleton, Wait } from "./Feedback.js";
import { Section } from "./Section.js";

const ERRORS: Record<string, string> = {
  invalid_key: "Gemini no aceptó esa clave. Revisá que esté completa.",
  gemini_busy: "Gemini no responde ahora.",
  unreachable: "Sin conexión: no se pudo guardar.",
};

/** Your own Gemini key for reading syllabi; without one, the app's is used. */
export function GeminiKey() {
  const sync = useSync();
  const client = sync?.client;
  const [own, setOwn] = useState<boolean | null>(null);
  const [fallback, setFallback] = useState(true);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; kind?: string } | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const lastAction = useRef<"set_key" | "clear_key">("set_key");
  // Only the latest question's answer counts: an older one arriving late is ignored.
  const latest = useRef(0);
  /** Reads which key is in use; returns a cancel for effects. */
  const load = useCallback(() => {
    if (!client) return undefined;
    let cancelled = false;
    const asked = ++latest.current;
    void geminiKey(client, "key_status").then((r) => {
      if (cancelled || asked !== latest.current) return;
      // Unknown, not "the app's key": the user may well have one stored.
      if (!r.ok) {
        setOwn(null);
        setError({ text: "No se pudo ver qué clave usás.", kind: "status" });
        return;
      }
      setError(null);
      setOwn(r.own);
      setFallback(r.fallback !== false);
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => load(), [load]);

  if (!client) return null;

  const run = async (action: "set_key" | "clear_key") => {
    lastAction.current = action;
    setBusy(true);
    setError(null);
    const r = await geminiKey(client, action, action === "set_key" ? key : undefined);
    setBusy(false);
    if (!r.ok) {
      setError({
        text: ERRORS[r.error] ?? "No se pudo guardar la clave: el servidor no respondió.",
        kind: r.error,
      });
      return;
    }
    // A status answer still on its way is older than this change: it must not count.
    latest.current++;
    setOwn(r.own);
    if (r.fallback !== undefined) setFallback(r.fallback);
    setKey("");
  };

  return (
    <Section>
      {own === null && !error && (
        <>
          <Skeleton width="70%" />
          <Wait label="Viendo qué clave usás" />
        </>
      )}
      <p className="meta">
        {own === null
          ? error
            ? "No sé qué clave se usa ahora."
            : ""
          : own
            ? "Usás tu propia clave de Gemini para leer programas."
            : fallback
              ? "Usás la clave de critiCal. Con la tuya, la cuota gratis es solo tuya."
              : "No hay clave de Gemini: cargá la tuya para leer programas con IA."}{" "}
        Se consigue gratis en{" "}
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
          Google AI Studio
        </a>
        . Queda guardada cifrada en el servidor y no se vuelve a mostrar.
      </p>
      <div className="row">
        <input
          type="password"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-label="Clave de Gemini"
          ref={field}
          placeholder={own ? "Cambiar por otra clave" : "Pegá tu clave"}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <button
          type="button"
          className="btn small primary"
          disabled={busy || !key.trim()}
          onClick={() => void run("set_key")}
        >
          Guardar
        </button>
      </div>
      {own !== false && (
        <button
          type="button"
          className="btn"
          style={{ width: "100%" }}
          disabled={busy}
          onClick={() => void run("clear_key")}
        >
          Quitar mi clave
        </button>
      )}
      {busy && <Wait label="Guardando la clave" />}
      {error && (
        <ErrorNote
          action={
            error.kind === "status"
              ? { label: "Volver a probar", onClick: () => void load() }
              : error.kind === "invalid_key"
                ? { label: "Pegar otra clave", onClick: () => field.current?.focus() }
                : { label: "Probar de nuevo", onClick: () => void run(lastAction.current) }
          }
        >
          {error.text}
        </ErrorNote>
      )}
    </Section>
  );
}
