import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./components/ErrorBoundary.js";

const report = vi.fn();
vi.mock("./monitoring.js", async (original) => ({
  ...(await original<typeof import("./monitoring.js")>()),
  reportError: (e: unknown) => report(e),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  report.mockReset();
});

function Broken(): never {
  throw new Error("render failed");
}

describe("ErrorBoundary", () => {
  it("shows what to do instead of a blank screen and reports the error", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert").textContent).toContain("Algo falló");
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: "render failed" }));
    expect(report.mock.calls[0]?.[0]).toHaveProperty("componentStack");
  });

  it("reloads, or starts over from the server's copy when the device data breaks it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    localStorage.setItem("critical.demo.v2", "{}");
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Recargar" }));
    expect(reload).toHaveBeenCalledOnce();
    fireEvent.click(
      screen.getByRole("button", { name: "Descartar lo de este dispositivo y recargar" }),
    );
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
    expect(localStorage.getItem("critical.demo.v2")).toBeNull();
  });

  it("renders its children when nothing fails", () => {
    render(
      <ErrorBoundary>
        <p>Semana</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("Semana")).toBeTruthy();
  });
});
