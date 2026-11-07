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

function Two({ onUndo }: { onUndo: () => void }) {
  const toast = useToast();
  return (
    <>
      <button type="button" onClick={() => toast.show("Movido", { undo: onUndo })}>
        Mover
      </button>
      <button type="button" onClick={() => toast.show("Reglas guardadas")}>
        Guardar
      </button>
    </>
  );
}

function Chain() {
  const toast = useToast();
  const again = () => toast.show("Otra vez", { undo: again });
  return (
    <button type="button" onClick={again}>
      Mover
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
    expect(screen.getAllByRole("status")[1]?.textContent).toContain("Reglas guardadas");
    act(() => {
      vi.advanceTimersByTime(TOAST_MS + 10);
    });
    expect(screen.getAllByRole("status")[1]?.textContent).toBe("");
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

  it("still goes away after an undo tapped with the pointer on it", () => {
    const undo = vi.fn();
    render(
      <ToastProvider>
        <Two onUndo={undo} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("Mover"));
    const button = screen.getByRole("button", { name: "Deshacer" });
    fireEvent.pointerEnter(button);
    fireEvent.click(button);
    fireEvent.click(screen.getByText("Guardar"));
    act(() => {
      vi.advanceTimersByTime(TOAST_MS + 10);
    });
    expect(screen.queryByText("Reglas guardadas")).toBeNull();
  });

  it("keeps a replacement notice while its «Deshacer» still has focus", () => {
    render(
      <ToastProvider>
        <Chain />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("Mover"));
    const undo = screen.getByRole("button", { name: "Deshacer" });
    undo.focus();
    fireEvent.click(undo);
    screen.getByRole("button", { name: "Deshacer" }).focus();
    act(() => {
      vi.advanceTimersByTime(UNDO_MS * 2);
    });
    expect(screen.getByText("Otra vez")).toBeTruthy();
  });

  it("stays until both the pointer and the focus have left", () => {
    render(
      <ToastProvider>
        <Trigger undo={() => {}} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("Guardar"));
    const notice = screen.getByText("Reglas guardadas");
    fireEvent.pointerEnter(notice);
    fireEvent.focus(screen.getByRole("button", { name: "Deshacer" }));
    fireEvent.pointerLeave(notice);
    act(() => {
      vi.advanceTimersByTime(UNDO_MS * 2);
    });
    expect(screen.getByText("Reglas guardadas")).toBeTruthy();
    fireEvent.blur(screen.getByRole("button", { name: "Deshacer" }));
    act(() => {
      vi.advanceTimersByTime(UNDO_MS + 10);
    });
    expect(screen.queryByText("Reglas guardadas")).toBeNull();
  });

  it("does nothing outside the app (a screen tested alone)", () => {
    render(<Trigger />);
    fireEvent.click(screen.getByText("Guardar"));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
