import { fireEvent, screen } from "@testing-library/react";

/** Taps «Hecho» and, when the card asks which parts were done, goes on without choosing. */
export function tapDone(el: HTMLElement): void {
  fireEvent.click(el);
  confirmParts();
}

/** The card that asks for the parts done is answered without choosing any. */
export function confirmParts(): void {
  const ok = screen.queryByRole("button", { name: "Anotar hecho" });
  if (ok) fireEvent.click(ok);
}
