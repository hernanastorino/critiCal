import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLOSE_GRACE_MS,
  isGhostTap,
  notePress,
  SAME_SPOT_PX,
  useModal,
} from "./components/modal.js";
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
  it("is held back for a moment on the same spot, only outside an open sheet, only when real", () => {
    const below = document.createElement("button");
    document.body.append(below);
    const { unmount } = render(
      <ToastProvider>
        <Sheet />
      </ToastProvider>,
    );
    // The tap on «Guardar», at the bottom right, closes the sheet.
    notePress(300, 700);
    unmount();
    const now = Date.now();
    const tap = (x: number, y: number, target: EventTarget = below, isTrusted = true) => ({
      isTrusted,
      target,
      clientX: x,
      clientY: y,
    });
    expect(isGhostTap(tap(305, 702), now)).toBe(true);
    // A tap somewhere else is meant: it goes through (a tab right after closing with ✕).
    expect(isGhostTap(tap(300, 700 + SAME_SPOT_PX + 5), now)).toBe(false);
    // What code or tests dispatch is never held back.
    expect(isGhostTap(tap(300, 700, below, false), now)).toBe(false);
    // Later it is a tap of its own.
    expect(isGhostTap(tap(300, 700), now + CLOSE_GRACE_MS)).toBe(false);

    // Inside a sheet that is still open, the tap is meant for it.
    const open = document.createElement("div");
    open.className = "sheet";
    const inside = document.createElement("button");
    open.append(inside);
    document.body.append(open);
    expect(isGhostTap(tap(300, 700, inside), now)).toBe(false);
    below.remove();
    open.remove();
  });
});
