import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionSheet } from "./components/ActionSheet.js";
import { useModal } from "./components/modal.js";

afterEach(cleanup);

function Sheet({
  name,
  onClose,
  children,
}: {
  name: string;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useModal(ref, onClose);
  return (
    <div ref={ref} role="dialog" aria-label={name}>
      <h2>{name}</h2>
      <button type="button">Acción de {name}</button>
      {children}
    </div>
  );
}

describe("sheets inside sheets", () => {
  it("keeps the inner one reachable and the outer one, and the page, out of reach", () => {
    const closeOuter = vi.fn();
    const closeInner = vi.fn();
    const view = (inner: boolean) => (
      <div className="app">
        <button type="button">Fondo</button>
        <Sheet name="Ajustes" onClose={closeOuter}>
          <div className="page">
            <button type="button">Otra fila</button>
            {inner && <Sheet name="Silo" onClose={closeInner} />}
          </div>
        </Sheet>
      </div>
    );
    const { rerender } = render(view(false));
    rerender(view(true));
    const inner = screen.getByRole("dialog", { name: "Silo" });
    expect(inner.closest("[inert]")).toBeNull();
    expect(screen.getByText("Otra fila").inert).toBe(true);
    expect(screen.getByText("Acción de Ajustes").inert).toBe(true);
    expect(screen.getByText("Fondo").inert).toBe(true);
    expect(document.activeElement?.textContent).toBe("Silo");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(closeInner).toHaveBeenCalledOnce();
    expect(closeOuter).not.toHaveBeenCalled();
    rerender(view(false));
    // Back to the outer sheet: its own controls work again, the page stays covered.
    expect(screen.getByText("Otra fila").inert).toBeFalsy();
    expect(screen.getByText("Fondo").inert).toBe(true);
    expect(document.activeElement?.textContent).toBe("Ajustes");
  });
});

describe("focus after a tap", () => {
  it("goes back to what was tapped to open the sheet, even if it never had focus", () => {
    const view = (open: boolean) => (
      <div className="app">
        <button type="button">Silo</button>
        {open && <Sheet name="Detalle" onClose={() => {}} />}
      </div>
    );
    const { rerender } = render(view(false));
    const silo = screen.getByText("Silo");
    // A tap in Safari: pointerdown and click, but the button does not take focus.
    fireEvent.pointerDown(silo);
    (document.activeElement as HTMLElement | null)?.blur();
    rerender(view(true));
    rerender(view(false));
    expect(document.activeElement).toBe(silo);
  });
});

function Unnamed() {
  const ref = useRef<HTMLDivElement>(null);
  useModal(ref, () => {});
  return (
    <div ref={ref} role="dialog">
      <h2>Gym</h2>
    </div>
  );
}

describe("an old tap", () => {
  it("is not taken for what opened a sheet much later", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const view = (open: boolean) => (
      <div className="app">
        <button type="button">Antes</button>
        {open && <Sheet name="Plan" onClose={() => {}} />}
      </div>
    );
    const { rerender } = render(view(false));
    fireEvent.pointerDown(screen.getByText("Antes"));
    vi.setSystemTime(Date.now() + 5000);
    (document.activeElement as HTMLElement | null)?.blur();
    rerender(view(true));
    rerender(view(false));
    expect(document.activeElement).not.toBe(screen.getByText("Antes"));
    vi.useRealTimers();
  });
});

describe("sheet names", () => {
  it("names a sheet without a label after its heading", () => {
    render(<Unnamed />);
    expect(screen.getByRole("dialog", { name: "Gym" })).toBeTruthy();
  });
});

describe("action sheet", () => {
  it("starts on its first option, and Escape cancels", () => {
    const onCancel = vi.fn();
    render(
      <ActionSheet
        title="Eliminar"
        options={[{ label: "Eliminar todo", onPick: () => {} }]}
        onCancel={onCancel}
      />,
    );
    // On «Cancelar»: an extra Enter must not delete anything.
    expect(document.activeElement?.textContent).toBe("Cancelar");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
