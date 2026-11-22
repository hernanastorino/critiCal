import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CLOSE_GRACE_MS, isGhostTap, useModal } from "./components/modal.js";
import { ToastProvider } from "./components/Toast.js";

afterEach(cleanup);

function Sheet() {
  const ref = useRef<HTMLDivElement>(null);
  useModal(ref, () => {});
  return (
    <div ref={ref} className="sheet" role="dialog" aria-label="Hoja">
      <h2>Hoja</h2>
      <button type="button">Guardar</button>
    </div>
  );
}

// 23.ª vuelta del atacante: un doble toque en «Guardar avance» cerraba la hoja y el
// segundo toque caía en la barra de abajo (cambiaba de pestaña).
describe("the second tap of a double tap after a sheet closes", () => {
  it("is held back for a moment, only outside an open sheet, and only when real", () => {
    const below = document.createElement("button");
    document.body.append(below);
    const { unmount } = render(
      <ToastProvider>
        <Sheet />
      </ToastProvider>,
    );
    unmount();
    const now = Date.now();
    expect(isGhostTap({ isTrusted: true, target: below }, now)).toBe(true);
    // What code or tests dispatch is never held back.
    expect(isGhostTap({ isTrusted: false, target: below }, now)).toBe(false);
    // Later it is a tap of its own.
    expect(isGhostTap({ isTrusted: true, target: below }, now + CLOSE_GRACE_MS)).toBe(false);

    // Inside a sheet that is still open, the tap is meant for it.
    const open = document.createElement("div");
    open.className = "sheet";
    const inside = document.createElement("button");
    open.append(inside);
    document.body.append(open);
    expect(isGhostTap({ isTrusted: true, target: inside }, now)).toBe(false);
    below.remove();
    open.remove();
  });
});
