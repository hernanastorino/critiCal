import { useEffect, useState } from "react";
import { useSync } from "../Connected.js";
import { geminiKey } from "../remote.js";

const ERRORS: Record<string, string> = {
  invalid_key: "Gemini no aceptó esa clave. Revisá que esté completa.",
  unreachable: "Sin conexión. Probá de nuevo.",
};

/** Your own Gemini key for reading syllabi; without one, the app's is used. */
export function GeminiKey() {
  const sync = useSync();
  const client = sync?.client;
  const [own, setOwn] = useState<boolean | null>(null);
  const [fallback, setFallback] = useState(true);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void geminiKey(client, "key_status").then((r) => {
      if (cancelled || !r.ok) return;
      setOwn(r.own);
      setFallback(r.fallback !== false);
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  if (!client) return null;

  const run = async (action: "set_key" | "clear_key") => {
    setBusy(true);
    setError(null);
    const r = await geminiKey(client, action, action === "set_key" ? key : undefined);
    setBusy(false);
    if (!r.ok) {
      setError(ERRORS[r.error] ?? "No se pudo guardar. Probá más tarde.");
      return;
    }
    setOwn(r.own);
    setKey("");
  };

  return (
    <details className="card prefs">
      <summary className="title">Tu IA (Gemini)</summary>
      <p className="meta">
        {own
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
      {own && (
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
      {error && <p className="meta">{error}</p>}
    </details>
  );
}
