import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import {
  LOGIN_DENIED,
  LOGIN_FAILED,
  LOGIN_LINK_EXPIRED,
  loginProblem,
  skipLoss,
} from "./friendly.js";

function Broken(): never {
  throw new Error("x");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("loginProblem (SPEC §18.1)", () => {
  const of = (q: string) => loginProblem(new URLSearchParams(q));

  it("says nothing when the address has no sign-in error", () => {
    expect(of("")).toBeNull();
    expect(of("tab=inbox")).toBeNull();
  });

  it("tells an expired link apart from a refused permission and from anything else", () => {
    expect(of("error=access_denied&error_code=otp_expired")).toBe(LOGIN_LINK_EXPIRED);
    expect(of("error=access_denied")).toBe(LOGIN_DENIED);
    expect(of("error=server_error")).toBe(LOGIN_FAILED);
  });
});

describe("skipLoss", () => {
  it("names the minutes the block has and the date, nothing invented", () => {
    expect(skipLoss(50, "12 nov")).toBe(
      "Si lo salteás, el plan tiene que encontrar 50 min en otro momento antes de la entrega del 12 nov.",
    );
    expect(skipLoss(120, "12 nov")).toContain("2 h ");
    expect(skipLoss(90, "12 nov")).toContain("1,5 h ");
  });
});

describe("a sign-in that did not work", () => {
  it("shows Roy desarmado with the way back, and cleans the address", () => {
    window.history.replaceState(null, "", "/?error=access_denied&error_code=otp_expired");
    const { container } = render(<App />);
    expect(screen.getByRole("alert").textContent).toContain("venció");
    expect(container.querySelector(".roy")?.getAttribute("data-anim")).toBe("desarmado");
    expect(window.location.search).toBe("");
    expect(screen.getByRole("button", { name: "Probar con datos de ejemplo" })).toBeTruthy();
  });

  it("shows nothing extra on a normal visit", () => {
    render(<App />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("a screen that broke", () => {
  it("has Roy desarmado and the buttons to go on", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { container } = render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
    expect(container.querySelector(".roy")?.getAttribute("data-anim")).toBe("desarmado");
    expect(screen.getByRole("button", { name: "Recargar" })).toBeTruthy();
  });
});
