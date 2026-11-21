import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ToastProvider } from "./components/Toast.js";

afterEach(() => {
  cleanup();
  document.documentElement.style.fontSize = "";
});

const place = () => {
  render(
    <ToastProvider>
      <p>app</p>
    </ToastProvider>,
  );
  return document.querySelector(".toasts")?.className;
};

describe("where notices go (SPEC §18.12)", () => {
  it("at the top with the usual text size", () => {
    document.documentElement.style.fontSize = "17px";
    expect(place()).toBe("toasts");
  });

  it("above the tab bar with large text (past 150 %)", () => {
    document.documentElement.style.fontSize = "32px";
    expect(place()).toBe("toasts low");
  });
});
