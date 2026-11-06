import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { startMonitoring } from "./monitoring.js";
import "./styles.css";
import { watchUpdates } from "./updates.js";

// iOS ignores user-scalable=no for pinch gestures; block them so the app never
// zooms away from its content.
for (const type of ["gesturestart", "gesturechange"]) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

void startMonitoring();
watchUpdates();

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
