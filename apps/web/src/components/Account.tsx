import { useEffect, useRef, useState } from "react";
import { useSync } from "../Connected.js";
import { CRITICAL } from "../model.js";
import { closeAccount } from "../remote.js";
import { useStore } from "../store.js";
import { downloadJson } from "./Backup.js";
import { ErrorNote, reloadAction, SESSION_EXPIRED, TIMED_OUT, Wait } from "./Feedback.js";
import { Section } from "./Section.js";

/** What has to be typed to delete the account. */
export const CONFIRM_WORD = "BORRAR";

const ERRORS: Record<string, string> = {
  owner_cannot_delete:
    "Esta es la cuenta dueña: maneja las invitaciones y no se puede borrar. Podés revocar los permisos.",
  google_api_error: "Google no dejó borrar el calendario «📚 Plan». No se borró nada.",
  token_refresh_failed: "Google no respondió. No se borró nada.",
  google_revoke_failed: "Google no respondió. No se borró nada.",
  unreachable: "Sin conexión. No se borró nada: hace falta internet.",
  unauthorized: `${SESSION_EXPIRED} No se borró nada.`,
  timeout: `${TIMED_OUT} No se borró nada.`,
};

/**
 * «Revocar todo y borrar la cuenta», in one place: export first, then revoke Google,
 * forget the iCloud password and the Gemini key, optionally delete the «📚 Plan»
 * calendar, and delete the account with all its data. Hidden in demo mode.
 */
export function Account({ onDeleted }: { onDeleted?: () => void }) {
  const sync = useSync();
  const client = sync?.client;
  const { data, now } = useStore();
  const [owner, setOwner] = useState(false);
  const [deletePlan, setDeletePlan] = useState(true);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    error?: boolean;
    session?: boolean;
  } | null>(null);
  const lastAction = useRef<"revoke" | "delete">("revoke");

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    // Unanswered (offline): deletion stays offered and the server still refuses the owner.
    void Promise.resolve()
      .then(() => client.rpc("is_owner"))
      .then(({ data }) => {
        if (!cancelled) setOwner(data === true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client]);

  if (!sync || !client) return null;

  const run = async (action: "revoke" | "delete") => {
    lastAction.current = action;
    setBusy(true);
    setMessage(null);
    const r = await closeAccount(client, action, deletePlan);
    setBusy(false);
    if (!r.ok) {
      setMessage({
        text: ERRORS[r.error] ?? "El servidor falló. No se borró nada.",
        error: true,
        session: r.error === "unauthorized",
      });
      return;
    }
    if (action === "delete") {
      onDeleted?.();
      return;
    }
    setMessage({ text: "critiCal ya no tiene acceso a Google, iCloud ni a tu clave de Gemini." });
    await sync.syncNow();
  };

  return (
    <Section>
      <p className="meta">
        Revoca el acceso a Google Calendar y borra la contraseña de iCloud y tu clave de Gemini
        {owner
          ? "."
          : ", y elimina la cuenta con todos sus datos (materias, entregas, plan, lugares y tu invitación). No se puede deshacer."}
      </p>
      <p className="meta">Antes, guardá una copia de tus datos:</p>
      <button type="button" className="btn" onClick={() => downloadJson(data, now)}>
        Exportar JSON
      </button>
      <label className="check">
        <input
          type="checkbox"
          checked={deletePlan}
          onChange={(e) => setDeletePlan(e.target.checked)}
        />
        <span>Borrar también el calendario «📚 Plan» de Google</span>
      </label>
      {owner ? (
        <>
          <p className="meta">{ERRORS.owner_cannot_delete}</p>
          <button
            type="button"
            className="btn"
            disabled={busy}
            style={{ width: "100%" }}
            onClick={() => void run("revoke")}
          >
            {busy ? "Revocando…" : "Revocar todo"}
          </button>
        </>
      ) : (
        <>
          <label className="field">
            <span>Escribí {CONFIRM_WORD} para confirmar</span>
            <input
              value={typed}
              autoCapitalize="characters"
              autoComplete="off"
              onChange={(e) => setTyped(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn"
            disabled={busy || typed.trim().toUpperCase() !== CONFIRM_WORD}
            style={{ width: "100%", color: CRITICAL }}
            onClick={() => void run("delete")}
          >
            {busy ? "Borrando…" : "Borrar mi cuenta"}
          </button>
        </>
      )}
      {busy && (
        <Wait
          label={lastAction.current === "delete" ? "Borrando tu cuenta" : "Revocando accesos"}
        />
      )}
      {message &&
        (message.error ? (
          <ErrorNote
            action={
              message.text === ERRORS.owner_cannot_delete
                ? undefined
                : message.session
                  ? reloadAction
                  : {
                      label: "Probar de nuevo",
                      onClick: () => void run(lastAction.current),
                      disabled: busy,
                    }
            }
          >
            {message.text}
          </ErrorNote>
        ) : (
          <p className="meta">{message.text}</p>
        ))}
    </Section>
  );
}
