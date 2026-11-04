/** Wait after a new worker takes over, so the last local save lands before reloading. */
export const SETTLE_MS = 500;

/**
 * True while reloading would throw away what the user is doing: typing, a sheet or a
 * bubble open, a block being dragged.
 */
export function busy(doc: Document): boolean {
  const el = doc.activeElement;
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
  return !!doc.querySelector('[role="dialog"], .bubble-card, .pill.dragging');
}

/**
 * Shows a new deploy on this launch instead of the next one. The worker installs it in
 * the background and takes over; this reloads the page then, or, if the user is in the
 * middle of something, as soon as they leave the app. iOS resumes an installed app
 * without a navigation, so coming back to it also checks for a new version.
 */
export function watchUpdates(win: Window = window, reload = () => win.location.reload()) {
  const sw = win.navigator.serviceWorker;
  if (!sw) return;
  const doc = win.document;
  // The first install also takes control, but there is no old version to replace.
  let controlled = !!sw.controller;
  let pending = false;
  const attempt = () => {
    if (!pending || (doc.visibilityState === "visible" && busy(doc))) return;
    pending = false;
    reload();
  };
  sw.addEventListener("controllerchange", () => {
    const replaced = controlled;
    controlled = true;
    if (!replaced || pending) return;
    pending = true;
    win.setTimeout(attempt, SETTLE_MS);
  });
  doc.addEventListener("visibilitychange", () => {
    if (doc.visibilityState === "hidden") attempt();
    else
      void sw
        .getRegistration()
        .then((r) => r?.update())
        .catch(() => undefined);
  });
}
