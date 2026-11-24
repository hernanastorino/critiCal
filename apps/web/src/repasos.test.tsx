import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ToastProvider } from "./components/Toast.js";
import { Week } from "./components/Week.js";
import { demoData } from "./demo.js";
import type { AppData } from "./model.js";
import { reducer, StoreProvider } from "./store.js";

afterEach(cleanup);

const NOW = Date.UTC(2026, 10, 2, 20);

/** The demo's plan with its first future block marked as a spaced review. */
function setup() {
  const d = reducer(demoData(NOW), { type: "refresh", now: NOW });
  const first = d.plan.find((b) => b.start > NOW);
  if (!first) throw new Error("a future block is needed");
  const title = d.tasks.find((t) => t.id === first.taskId)?.title ?? "";
  const data: AppData = {
    ...d,
    plan: d.plan.map((b) => (b.id === first.id ? { ...b, review: true } : b)),
  };
  return { data, title };
}

function show(data: AppData) {
  render(
    <StoreProvider initial={() => data} persist={false} fixedNow={NOW}>
      <ToastProvider>
        <Week onSettings={() => {}} />
      </ToastProvider>
    </StoreProvider>,
  );
}

describe("repasos espaciados en la semana", () => {
  it("la burbuja lleva el ícono de repetir y «Repaso» en su nombre; las demás no", () => {
    const { data, title } = setup();
    show(data);
    const review = screen.getByRole("button", { name: /^Repaso · / });
    expect(review.getAttribute("aria-label")).toContain(`Repaso · ${title}`);
    expect(review.innerHTML).toContain("<svg");
  });

  it("el globito dice «Repaso · tarea»", () => {
    const { data, title } = setup();
    show(data);
    fireEvent.click(screen.getByRole("button", { name: /^Repaso · / }));
    const bubble = screen.getByRole("dialog");
    expect(within(bubble).getByRole("heading", { name: `Repaso · ${title}` })).toBeTruthy();
  });
});
