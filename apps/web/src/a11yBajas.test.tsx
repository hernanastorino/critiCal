import { readFileSync } from "node:fs";
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

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  clearDrafts();
});

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi as number) + 0.05) / ((lo as number) + 0.05);
};

describe("contraste AA del texto azul", () => {
  const token = (block: string) =>
    css.match(new RegExp(`${block}[^}]*?--link-ink: (#[0-9a-f]{6})`))?.[1];

  it("the action sheet options use a blue that is at least 4.5:1 on its surface, light and dark", () => {
    expect(css).not.toMatch(/#0a72ff/i);
    expect(css).toMatch(/\.action \{[^}]*color: var\(--link-ink\)/);
    expect(contrast(token(":root") as string, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(token("prefers-color-scheme: dark\\) \\{\\s*:root \\{") as string, "#1c1f27"),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe("zoom", () => {
  it("the viewport does not block pinch zoom", () => {
    const viewport = html.match(/<meta name="viewport" content="([^"]*)"/)?.[1] ?? "";
    expect(viewport).not.toMatch(/maximum-scale|user-scalable/);
  });
});

describe("nombre repetido: el campo lo dice", () => {
  it("Rutinas marks the field and points it at the message", () => {
    inside(<Routines />);
    const taken = (latest as AppData).activities.find((a) => a.kind === "rutina")?.name ?? "";
    fireEvent.change(screen.getByLabelText("Rutina"), { target: { value: taken } });
    const field = screen.getByLabelText("Rutina");
    const alert = screen.getByRole("alert");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toBe(alert.id);
  });

  it("Semestre marks the field and points it at the message", () => {
    inside(<Semester />);
    const taken = (latest as AppData).activities[0]?.name ?? "";
    fireEvent.change(screen.getByLabelText("Materia"), { target: { value: taken } });
    const field = screen.getByLabelText("Materia");
    const alert = screen.getByRole("alert");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toBe(alert.id);
  });
});
