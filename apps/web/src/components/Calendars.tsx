import { useRef, useState } from "react";
import { useSync } from "../Connected.js";
import { isPlanCalendar, ROLE_LABEL, roleOf } from "../calendars.js";
import { time } from "../format.js";
import type { CalendarRole } from "../model.js";
import type { SyncResult } from "../remote.js";
import { useStore } from "../store.js";
import { ErrorNote, Skeleton, Wait } from "./Feedback.js";
import { Section } from "./Section.js";

const MESSAGES: Record<string, string> = {
  no_refresh_token: "Falta el permiso de Google Calendar. Tocá «Reconectar Google».",
  token_refresh_failed: "Google rechazó el permiso guardado. Tocá «Reconectar Google».",
  google_api_error: "Google Calendar rechazó el pedido.",
  unreachable: "No se pudo contactar al servidor de sincronización: revisá tu internet.",
  not_connected: "Sin conectar.",
  icloud_login_failed: "Apple ID o contraseña de app incorrectos.",
  icloud_auth_failed:
    "iCloud rechazó el Apple ID o la contraseña de app. Usá el mail principal del Apple ID y una contraseña específica de app recién creada.",
  icloud_unreachable: "No se pudo hablar con iCloud.",
  missing_credentials: "Completá el Apple ID y la contraseña de app.",
  sync_failed: "La sincronización falló.",
};

export function describe(r: SyncResult | undefined, tz: string, at?: number): string {
  if (!r) return "Sincronizando…";
  if (r.connected) return `✓ ${r.imported ?? 0} eventos${at ? ` · ${time(tz, at)}` : ""}`;
  if (r.reason === "invalid_client") {
    return "Google no acepta las credenciales del cliente: revisá que GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en Supabase sean los mismos que usa el login con Google.";
  }
  if (r.reason === "invalid_grant") return "Google revocó el permiso. Tocá «Reconectar Google».";
  const msg = r.error ? (MESSAGES[r.error] ?? "La sincronización falló.") : "Sin conectar.";
  return r.status ? `${msg} (${r.status})` : msg;
}

/** What the button next to a failure does: ask Google again, fix the password, or retry. */
export function fixFor(r: SyncResult | undefined): "reconnect" | "password" | "retry" | null {
  if (!r || r.connected || r.error === "not_connected") return null;
  if (r.reason === "invalid_grant" || r.error === "no_refresh_token") return "reconnect";
  if (r.error === "token_refresh_failed" && r.reason !== "invalid_client") return "reconnect";
  if (
    r.error === "icloud_login_failed" ||
    r.error === "icloud_auth_failed" ||
    r.error === "missing_credentials"
  )
    return "password";
  return "retry";
}

const ROLES = Object.keys(ROLE_LABEL) as CalendarRole[];

export const healthy = (r?: SyncResult) => !r || r.connected || r.error === "not_connected";

/**
 * Tiny status light: grey while syncing, green when everything is up to date, hollow
 * when offline with changes kept on this device, red on errors.
 */
export function SyncDot({ onClick }: { onClick: () => void }) {
  const sync = useSync();
  if (!sync) return null;
  const { status } = sync;
  const state = status.offline
    ? "offline"
    : status.busy
      ? "syncing"
      : healthy(status.google) && healthy(status.icloud)
        ? "ok"
        : "error";
  const label = {
    offline: "Sin conexión: los cambios se guardan en este dispositivo",
    syncing: "Sincronizando",
    ok: "Todo sincronizado",
    error: "Error de sincronización",
  }[state];
  return (
    <button
      type="button"
      className={`sync-dot ${state}`}
      aria-label={label}
      title={label}
      onClick={onClick}
    />
  );
}

export function Calendars() {
  const sync = useSync();
  const { data, dispatch } = useStore();
  const tz = data.settings.timezone;
  const [appleId, setAppleId] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [connecting, setConnecting] = useState(false);
  const password = useRef<HTMLInputElement>(null);
  if (!sync) return null;
  const { status } = sync;
  const icloudConnected = status.icloud?.connected;
  const googleFix = fixFor(status.google);
  const icloudFix = fixFor(status.icloud);
  const retry = () => void sync.syncNow();

  return (
    <Section className="calendars">
      <div className="card">
        <div className="title">Google Calendar</div>
        {!status.google && status.busy ? (
          <>
            <Skeleton width="60%" />
            <Wait label="Sincronizando Google" done={0} total={2} delay={0} />
          </>
        ) : googleFix ? (
          <ErrorNote
            testId="google-status"
            action={
              googleFix === "reconnect"
                ? { label: "Reconectar Google", onClick: sync.reconnectGoogle }
                : {
                    label: status.busy ? "Sincronizando…" : "Reintentar",
                    onClick: retry,
                    disabled: status.busy,
                  }
            }
          >
            {describe(status.google, tz, status.google?.at)}
          </ErrorNote>
        ) : (
          <p className="meta" data-testid="google-status">
            {describe(status.google, tz, status.google?.at)}
          </p>
        )}
        {status.busy && status.google && <Wait label="Sincronizando Google e iCloud" />}
        <div className="row">
          {googleFix !== "retry" && (
            <button type="button" className="btn small" disabled={status.busy} onClick={retry}>
              {status.busy ? "Sincronizando…" : "Sincronizar ahora"}
            </button>
          )}
          {!status.google?.connected && !googleFix && (
            <button type="button" className="btn small" onClick={sync.reconnectGoogle}>
              Reconectar Google
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <div className="title">iCloud</div>
        {icloudFix ? (
          <ErrorNote
            testId="icloud-status"
            action={
              icloudFix === "password"
                ? {
                    label: "Escribir la contraseña de nuevo",
                    onClick: () => password.current?.focus(),
                  }
                : { label: "Reintentar", onClick: retry, disabled: status.busy }
            }
          >
            {describe(status.icloud, tz, status.icloud?.at)}
          </ErrorNote>
        ) : (
          <p className="meta" data-testid="icloud-status">
            {describe(status.icloud, tz, status.icloud?.at)}
          </p>
        )}
        {icloudConnected ? (
          <button type="button" className="btn small" onClick={() => void sync.disconnectICloud()}>
            Desconectar iCloud
          </button>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setConnecting(true);
              const r = await sync.connectICloud(appleId, appPassword);
              setConnecting(false);
              if (r.connected) setAppPassword("");
            }}
          >
            <p className="meta">
              Creá una contraseña específica de app en{" "}
              <a href="https://account.apple.com/account/manage" target="_blank" rel="noreferrer">
                account.apple.com
              </a>{" "}
              → Inicio de sesión y seguridad → Contraseñas específicas de app. Se guarda cifrada y
              solo sirve para leer tus calendarios.
            </p>
            <label className="field">
              <span>Apple ID</span>
              <input
                type="email"
                autoComplete="username"
                value={appleId}
                onChange={(e) => setAppleId(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Contraseña específica de app</span>
              <input
                ref={password}
                type="password"
                autoComplete="off"
                placeholder="xxxx-xxxx-xxxx-xxxx"
                value={appPassword}
                onChange={(e) => setAppPassword(e.target.value)}
              />
            </label>
            {connecting && <Wait label="Conectando con iCloud" />}
            <button
              type="submit"
              className="btn primary"
              disabled={connecting}
              style={{ width: "100%" }}
            >
              {connecting ? "Conectando…" : "Conectar iCloud"}
            </button>
          </form>
        )}
      </div>

      {(data.calendars ?? []).length > 0 && (
        <div className="card">
          <div className="title">¿Qué es cada calendario?</div>
          <p className="meta">
            Parciales, entregas y presentaciones crean actividades solas. «Ocupado» bloquea el
            tiempo. En cualquier calendario (salvo los que marques «Ignorar»), un evento con
            #parcial, #entrega (o 📝) o #presentación en el título también se toma como tal.
          </p>
          {(data.calendars ?? [])
            .filter((c) => !isPlanCalendar(c.name))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((c) => (
              <label key={c.id} className="check">
                <span style={{ flex: 1 }}>
                  {c.name}{" "}
                  <span className="meta" style={{ margin: 0 }}>
                    {c.source === "icloud" ? "iCloud" : "Google"}
                  </span>
                </span>
                <select
                  aria-label={`Tipo de ${c.name}`}
                  style={{ width: "auto" }}
                  value={roleOf(c)}
                  onChange={(e) =>
                    dispatch({
                      type: "calendarRole",
                      calendarId: c.id,
                      role: e.target.value as CalendarRole,
                    })
                  }
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </label>
            ))}
        </div>
      )}
    </Section>
  );
}
