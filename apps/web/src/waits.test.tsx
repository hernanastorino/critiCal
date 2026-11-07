import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Loading, loadingText } from "./components/Loading.js";
import { Notice } from "./components/Notice.js";
import { SkeletonCards, WeekSkeleton } from "./components/Skeleton.js";
import { FREE_TODAY, mealNoRoom, SKIPPED_TOAST } from "./friendly.js";

afterEach(cleanup);

describe("Loading", () => {
  it("says what it is doing for each kind", () => {
    expect(loadingText("sync")).toBe("Sincronizando tu calendario…");
    expect(loadingText("ai")).toBe("Leyendo el programa…");
    expect(loadingText("travel")).toBe("Calculando traslados…");
    expect(loadingText("generic")).toBe("Cargando…");
    expect(loadingText("generic", "Cargando qué clave usás…")).toBe("Cargando qué clave usás…");
  });

  it("shows how far along it is when that is known", () => {
    expect(loadingText("travel", undefined, { done: 2, total: 8 })).toBe(
      "Calculando traslados 3 de 8…",
    );
    // Never past the end.
    expect(loadingText("travel", undefined, { done: 8, total: 8 })).toBe(
      "Calculando traslados 8 de 8…",
    );
    expect(loadingText("travel", undefined, { done: 0, total: 0 })).toBe("Calculando traslados…");
  });

  it("is announced as a status, with a bar only when progress is known", () => {
    const { rerender } = render(<Loading kind="sync" />);
    expect(screen.getByRole("status").textContent).toContain("Sincronizando");
    expect(document.querySelector("progress")).toBeNull();
    rerender(<Loading kind="travel" progress={{ done: 1, total: 4 }} />);
    expect(document.querySelector("progress")?.getAttribute("max")).toBe("4");
    expect(screen.getByRole("status").getAttribute("data-kind")).toBe("travel");
  });

  it("leaves a slot for the mascot", () => {
    render(<Loading kind="ai" mascot={<span data-testid="mascot" />} />);
    expect(screen.getByTestId("mascot")).toBeTruthy();
    expect(document.querySelector(".loading-shape")).toBeNull();
  });
});

describe("skeletons", () => {
  it("draw grey shapes that screen readers skip", () => {
    render(<SkeletonCards count={3} />);
    expect(document.querySelectorAll(".skeleton-card").length).toBe(3);
    expect(document.querySelector(".skeleton")?.getAttribute("aria-hidden")).toBe("true");
    cleanup();
    render(<WeekSkeleton />);
    expect(document.querySelectorAll(".skeleton-day").length).toBe(7);
  });
});

describe("Notice", () => {
  it("tells what to do with a button to do it", () => {
    const reconnect = vi.fn();
    render(
      <Notice
        title="Google se desconectó"
        message="Pasa. Reconectá y seguimos."
        actions={[{ label: "Reconectar Google", onClick: reconnect, primary: true }]}
        mascot={<span data-testid="mascot" />}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Reconectá");
    fireEvent.click(screen.getByText("Reconectar Google"));
    expect(reconnect).toHaveBeenCalled();
    expect(screen.getByTestId("mascot")).toBeTruthy();
  });

  it("works without actions or mascot", () => {
    render(<Notice message="Todo bien" />);
    expect(document.querySelector(".row")).toBeNull();
    expect(document.querySelector(".notice-mascot")).toBeNull();
  });
});

describe("unhappy-path texts", () => {
  it("always give the way out and never blame", () => {
    expect(mealNoRoom("11:30", "15:30", "13:00")).toMatch(/Hoy no/);
    expect(mealNoRoom("11:30", "15:30", "13:00")).toMatch(/13:00/);
    expect(SKIPPED_TOAST).toMatch(/sin culpa/);
    expect(FREE_TODAY).toMatch(/libre/);
  });
});
