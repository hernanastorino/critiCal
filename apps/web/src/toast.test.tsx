import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOAST_MS, ToastProvider, UNDO_MS, useToast } from "./components/Toast.js";

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Trigger({ undo }: { undo?: () => void }) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => toast.show("Reglas guardadas", undo ? { undo } : undefined)}
    >
      Guardar
    </button>
  );
}

describe("the app's one notice", () => {
  it("is announced, and goes away after a while", () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("Guardar"));
    expect(screen.getByRole("status").textContent).toContain("Reglas guardadas");
    act(() => {
      vi.advanceTimersByTime(TOAST_MS + 10);
    });
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("stays while the pointer is on it, and leaves after", () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("Guardar"));
    fireEvent.pointerEnter(screen.getByText("Reglas guardadas"));
    act(() => {
      vi.advanceTimersByTime(TOAST_MS * 3);
    });
    expect(screen.getByText("Reglas guardadas")).toBeTruthy();
    fireEvent.pointerLeave(screen.getByText("Reglas guardadas"));
    act(() => {
      vi.advanceTimersByTime(TOAST_MS + 10);
    });
    expect(screen.queryByText("Reglas guardadas")).toBeNull();
  });

  it("offers to undo for longer, and undoing takes it away", () => {
    const undo = vi.fn();
    render(
      <ToastProvider>
        <Trigger undo={undo} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("Guardar"));
    act(() => {
      vi.advanceTimersByTime(TOAST_MS + 10);
    });
    expect(screen.getByRole("button", { name: "Deshacer" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(undo).toHaveBeenCalledOnce();
    expect(screen.queryByText("Reglas guardadas")).toBeNull();
    expect(UNDO_MS).toBeGreaterThan(TOAST_MS);
  });

  it("does nothing outside the app (a screen tested alone)", () => {
    render(<Trigger />);
    fireEvent.click(screen.getByText("Guardar"));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
