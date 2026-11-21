import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Silos } from "./components/Silos.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, emptyData } from "./demo.js";
import type { AppData } from "./model.js";
import { StoreProvider } from "./store.js";

afterEach(cleanup);

const NOW = Date.UTC(2026, 10, 2, 20);

const silos = (initial: () => AppData) =>
  render(
    <StoreProvider initial={initial} persist={false} fixedNow={NOW}>
      <ToastProvider>
        <Silos />
      </ToastProvider>
    </StoreProvider>,
  );

describe("empty states (SPEC §14)", () => {
  it("Silos with nothing yet says what goes there and where to start", () => {
    silos(emptyData);
    expect(screen.getByText(/Acá van tus entregas, parciales y rutinas/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Nueva actividad" })).toBeTruthy();
  });

  it("is not shown once there is something", () => {
    silos(() => demoData(NOW));
    expect(screen.queryByText(/Acá van tus entregas/)).toBeNull();
  });
});
