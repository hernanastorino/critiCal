import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, describe as group, it } from "vitest";
import { App } from "./App.js";
import { describe } from "./components/Calendars.js";
import { demoData } from "./demo.js";

afterEach(cleanup);

group("sync messages", () => {
  const tz = "America/Montevideo";
  it("explains each failure", () => {
    expect(describe(undefined, tz)).toBe("Sincronizando…");
    expect(describe({ connected: true, imported: 3 }, tz, Date.UTC(2026, 10, 2, 22))).toBe(
      "✓ 3 eventos · 19:00",
    );
    expect(
      describe(
        { connected: false, error: "token_refresh_failed", status: 401, reason: "invalid_client" },
        tz,
      ),
    ).toMatch(/GOOGLE_CLIENT_SECRET/);
    expect(
      describe({ connected: false, error: "token_refresh_failed", reason: "invalid_grant" }, tz),
    ).toMatch(/Reconectar/);
    expect(describe({ connected: false, error: "icloud_auth_failed", status: 401 }, tz)).toMatch(
      /rechazó el Apple ID.*\(401\)/,
    );
    expect(describe({ connected: false, error: "weird" }, tz)).toMatch(/Sincronizar ahora/);
    expect(describe({ connected: false }, tz)).toBe("Sin conectar.");
  });
});

group("sheets", () => {
  it("close with the ✕ button", () => {
    localStorage.setItem("critical.mode", "demo");
    render(<App fixedNow={Date.UTC(2026, 10, 2, 20)} initial={demoData} />);
    fireEvent.click(screen.getByLabelText("Ajustes"));
    const close = document.querySelector(".sheet-close") as HTMLElement;
    expect(close.textContent).toContain("✕");
    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
