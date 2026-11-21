import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Routines } from "./components/Preferences.js";
import { Semester } from "./components/Semester.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { clearDrafts } from "./drafts.js";
import { zonedInstant } from "./engine.js";
import type { AppData } from "./model.js";
import { StoreProvider, useStore } from "./store.js";

const html = Object.values(
  import.meta.glob<string>("../index.html", { query: "?raw", import: "default", eager: true }),
).join("");

const NOW = zonedInstant(TIMEZONE, "2026-11-18", 12 * 60);
let latest: AppData | undefined;
function Spy() {
  latest = useStore().data;
  return null;
}
const inside = (ui: React.ReactNode) =>
  render(
    <ToastProvider>
      <StoreProvider initial={demoData} persist={false} fixedNow={NOW}>
        <Spy />
        {ui}
      </StoreProvider>
    </ToastProvider>,
  );

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  clearDrafts();
});

describe("zoom", () => {
  it("the viewport does not block pinch zoom", () => {
    const viewport = html.match(/<meta name="viewport" content="([^"]*)"/)?.[1] ?? "";
    expect(viewport).toContain("width=device-width");
    expect(viewport).not.toMatch(/maximum-scale|user-scalable/);
  });
});

describe("nombre repetido: el campo lo dice", () => {
  it("Rutinas marks the field and points it at the message", () => {
    inside(<Routines />);
    const taken = latest?.activities.find((a) => a.kind === "rutina")?.name ?? "";
    fireEvent.change(screen.getByLabelText("Rutina"), { target: { value: taken } });
    const field = screen.getByLabelText("Rutina");
    const alert = screen.getByRole("alert");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toBe(alert.id);
  });

  it("Semestre marks the field and points it at the message", () => {
    inside(<Semester />);
    const taken = latest?.activities[0]?.name ?? "";
    fireEvent.change(screen.getByLabelText("Materia"), { target: { value: taken } });
    const field = screen.getByLabelText("Materia");
    const alert = screen.getByRole("alert");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toBe(alert.id);
  });
});
