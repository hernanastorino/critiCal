import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { App } from "./App";

it("renders the engine status", () => {
  render(<App />);
  expect(screen.getByTestId("engine-status").textContent).toContain("listo");
});
