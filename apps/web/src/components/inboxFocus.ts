import { type RefObject, useEffect, useRef } from "react";

const FOCUSABLE = "button, input, a[href], select, textarea";

/**
 * Keeps keyboard and screen-reader focus from falling to <body> when the card the user
 * just acted on disappears: it goes to the card that took its place (the next one, or the
 * previous when it was the last) and, with none left, to `fallback` (the screen title).
 * Wire the returned handler as `onClickCapture` on the list that holds the `.card`s.
 */
export function useKeepFocus(
  list: RefObject<HTMLElement | null>,
  fallback: RefObject<HTMLElement | null>,
) {
  const acted = useRef<number | null>(null);
  useEffect(() => {
    const index = acted.current;
    const root = list.current;
    if (index === null || !root) return;
    acted.current = null;
    const active = document.activeElement;
    // Still on something real (the card stayed, or the action moved focus): leave it.
    if (active && active !== document.body && active.isConnected) return;
    const cards = [...root.querySelectorAll<HTMLElement>(".card")];
    const near = cards[index] ?? cards[index - 1];
    (near?.querySelector<HTMLElement>(FOCUSABLE) ?? fallback.current)?.focus();
  });
  return (e: React.MouseEvent<HTMLElement>) => {
    const card = (e.target as HTMLElement).closest(".card");
    const cards = [...e.currentTarget.querySelectorAll(".card")];
    acted.current = card ? cards.indexOf(card) : null;
  };
}
