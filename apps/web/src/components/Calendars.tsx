import { useState } from "react";
import { useSync } from "../Connected";
import { ROLE_LABEL, roleOf } from "../calendars";
import { time } from "../format";
import type { CalendarRole } from "../model";
import type { SyncResult } from "../remote";
import { useStore } from "../store";

const MESSAGES: Record<string, string> = {
  no_refresh_token: "Falta el permiso de Google Calendar. Tocá «Reconectar Google».",
  token_refresh_failed: "Google rechazó el permiso guardado. Tocá «Reconectar Google».",
  google_api_error: "Google Calendar rechazó el pedido.",
  unreachable: "No se pudo contactar al servidor de sincronización.",
  not_connected: "Sin conectar.",
  icloud_login_failed: "Apple ID o contraseña de app incorrectos.",
  missing_credentials: "Completá el Apple ID y la contraseña de app.",
  sync_failed: "La sincronización falló.",
};

export function describe(r: SyncResult | undefined, tz: string, at?: number): string {
  if (!r) return "Sincronizando…";
  if (r.connected) return `✓ ${r.imported ?? 0} eventos${at ? ` · ${time(tz, at)}` : ""}`;
  const msg = (r.error && MESSAGES[r.error]) || "La sincronización falló.";
  return r.status ? `${msg} (${r.status})` : msg;
}

const ROLES = Object.keys(ROLE_LABEL) as CalendarRole[];

export function Calendars() {
  const sync = useSync();
  const { data, dispatch } = useStore();
  const tz = data.settings.timezone;
  const [appleId, setAppleId] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [connecting, setConnecting] = useState(false);
  if (!sync) return null;
  const { status } = sync;
  const icloudConnected = status.icloud?.connected;

  return (
    <>
      <div className="section-title">Calendarios</div>
      <div className="card">
        <div className="title">Google Calendar</div>
        <p className="meta" data-testid="google-status">
          {describe(status.google, tz, status.google?.at)}
        </p>
        <div className="row">
          <button
            type="button"
            className="btn small"
            disabled={status.busy}
            onClick={() => void sync.syncNow()}
          >
            {status.busy ? "Sincronizando…" : "Sincronizar ahora"}
          </button>
          {!status.google?.connected && (
            <button type="button" className="btn small" onClick={sync.reconnectGoogle}>
              Reconectar Google
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <div className="title">iCloud</div>
        <p className="meta" data-testid="icloud-status">
          {describe(status.icloud, tz, status.icloud?.at)}
        </p>
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
                type="password"
                autoComplete="off"
                placeholder="xxxx-xxxx-xxxx-xxxx"
                value={appPassword}
                onChange={(e) => setAppPassword(e.target.value)}
              />
            </label>
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
            tiempo.
          </p>
          {(data.calendars ?? [])
            .slice()
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
    </>
  );
}
