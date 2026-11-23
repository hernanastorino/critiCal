/** The most the app's text grows with the system text size (px of the root). */
export const MAX_ROOT_PX = 24;

/**
 * The root follows the system text size (Dynamic Type), but only up to MAX_ROOT_PX: beyond that
 * the screens stop fitting. Clears the cap, reads what the system asks for and sets the cap if
 * it is more. Runs again when the text size may have changed (back to the app, rotation).
 */
export function capRootFontSize(root: HTMLElement = document.documentElement): void {
  root.style.removeProperty("font-size");
  const px = Number.parseFloat(getComputedStyle(root).fontSize);
  if (px > MAX_ROOT_PX) root.style.fontSize = `${MAX_ROOT_PX}px`;
}

export function watchRootFontSize(): void {
  capRootFontSize();
  window.addEventListener("resize", () => capRootFontSize());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) capRootFontSize();
  });
}
