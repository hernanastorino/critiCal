import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "../monitoring.js";
import { clearLocal } from "../offline.js";
import { resetDemo } from "../store.js";

/**
 * A render error shows what to do next instead of a blank screen, and goes to Sentry.
 * If the data on this device is what breaks it, reloading would break it again: the
 * second button starts over from the server's copy (or a fresh demo).
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  // Anything can be thrown (even null): it is reported as an Error, with where it broke.
  override componentDidCatch(error: unknown, info: ErrorInfo) {
    const err = error instanceof Error ? error : new Error(String(error));
    reportError(err, { componentStack: (info.componentStack ?? "").slice(0, 2000) });
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="login" role="alert">
        <h1>Algo falló</h1>
        <p>La pantalla se trabó (no fuiste vos). Recargá y seguimos.</p>
        <button type="button" className="btn primary" onClick={() => window.location.reload()}>
          Recargar
        </button>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            // What is only on this device is lost; your account's data loads again.
            await clearLocal().catch(() => undefined);
            resetDemo();
            window.location.reload();
          }}
        >
          Descartar lo de este dispositivo y recargar
        </button>
        <p className="meta">
          Si vuelve a pasar, el segundo botón borra lo guardado solo en este dispositivo: lo de tu
          cuenta sigue en el servidor.
        </p>
      </main>
    );
  }
}
