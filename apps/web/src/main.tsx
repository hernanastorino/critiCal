import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

// iOS ignores user-scalable=no for pinch gestures; block them so the app never
// zooms away from its content.
for (const type of ["gesturestart", "gesturechange"]) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
