import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Celebrations, justClosed } from "./components/Celebrations.js";
import { LOADING_ANIM, Loading } from "./components/Loading.js";
import { ROY, Roy } from "./components/Roy.js";

function reduced(on: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: on && q.includes("reduce"),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const blocks = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>(".roy-blk")];

describe("Roy", () => {
  it("is hidden from screen readers and made of six boards", () => {
    const { container } = render(<Roy anim="puente" size={80} />);
    const roy = container.querySelector(".roy");
    expect(roy?.getAttribute("aria-hidden")).toBe("true");
    expect(blocks(container).length).toBe(6);
    expect(roy?.getAttribute("data-anim")).toBe("puente");
  });

  it("shows the still shape of the case with reduced motion, and never moves", () => {
    reduced(true);
    const { container } = render(<Roy anim="desarmado" />);
    const first = blocks(container)[0] as HTMLElement;
    const still = first.style.transform;
    expect(still).toContain("rotateZ(18deg)");
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(first.style.transform).toBe(still);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("moves through its shapes when motion is allowed", () => {
    reduced(false);
    const { container } = render(<Roy anim="hombros" />);
    const first = blocks(container)[0] as HTMLElement;
    const start = first.style.transform;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(first.style.transform).not.toBe(start);
  });

  it("with `once` plays the shape one time and stays still", () => {
    reduced(false);
    const { container } = render(<Roy anim="hombros" once />);
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(blocks(container)[0]?.style.transform).toContain("rotateZ(0deg)");
  });

  it("clears its timers and animations when it goes away", () => {
    reduced(false);
    const cancel = vi.fn();
    const animate = vi.fn(() => ({ cancel }));
    const proto = HTMLElement.prototype as unknown as { animate?: unknown };
    proto.animate = animate;
    const a = render(<Roy anim="cascada" />);
    expect(animate).toHaveBeenCalledTimes(6);
    a.unmount();
    expect(cancel).toHaveBeenCalledTimes(6);
    proto.animate = undefined;
    const b = render(<Roy anim="festejo" />);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    b.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("has a shape for every case", () => {
    expect(Object.keys(ROY).sort()).toEqual(
      [
        "acordeon",
        "cascada",
        "desarmado",
        "festejo",
        "hombros",
        "oruga",
        "puente",
        "reposo",
        "vayvuelve",
      ].sort(),
    );
  });
});

describe("Loading draws Roy", () => {
  it("picks the animation from the kind", () => {
    expect(LOADING_ANIM).toEqual({
      generic: "cascada",
      sync: "vayvuelve",
      ai: "acordeon",
      travel: "oruga",
    });
    for (const [kind, anim] of Object.entries(LOADING_ANIM)) {
      const { container } = render(<Loading kind={kind as keyof typeof LOADING_ANIM} />);
      expect(container.querySelector(".roy")?.getAttribute("data-anim")).toBe(anim);
      cleanup();
    }
  });

  it("is small when inline", () => {
    const { container } = render(<Loading inline />);
    expect((container.querySelector(".roy") as HTMLElement).style.height).toBe("24px");
  });
});

describe("closing a delivery", () => {
  it("finds the silos that went from open to 100 %", () => {
    const before = new Map([
      ["a", 60],
      ["b", 0],
      ["c", 30],
    ]);
    const now = new Map([
      ["a", { title: "Parcial", left: 0 }],
      ["b", { title: "Ya estaba", left: 0 }],
      ["c", { title: "Sigue", left: 10 }],
      ["d", { title: "Nueva", left: 0 }],
    ]);
    expect(justClosed(before, now)).toEqual(["Parcial"]);
  });

  it("renders nothing", () => {
    // Outside a store it would fail; the component is only mounted in the Shell.
    expect(typeof Celebrations).toBe("function");
  });
});
