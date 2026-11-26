import { fireEvent, screen } from "@testing-library/react";
import { vi } from "vitest";
import { ANSWER_GUARD_MS } from "./components/Inbox.js";

/** A «Hecho» tap: with parts pending the card asks which ones, and one is chosen. */
export function tapDone(el: HTMLElement): void {
  fireEvent.click(el);
  confirmParts();
}

/** The card that asks for the parts done is answered with its first part (past the double-tap guard). */
export function confirmParts(): void {
  const ok = screen.queryByRole("button", { name: "Anotar hecho" });
  if (!ok) return;
  const part = screen.getAllByRole("button").find((b) => b.hasAttribute("aria-pressed"));
  if (!part) throw new Error("no part to choose");
  const real = Date.now();
  const spy = vi.spyOn(Date, "now").mockReturnValue(real + ANSWER_GUARD_MS + 1);
  part.focus();
  fireEvent.click(part);
  ok.focus();
  fireEvent.click(ok);
  spy.mockRestore();
}
