/** Wait after a new worker takes over, so the last edit reaches its save first. */
export const SETTLE_MS = 500;
/** How often a waiting reload checks whether the user is done. */
export const RETRY_MS = 2000;

const inFlight = new Set<Promise<unknown>>();
/** Reasons not to reload yet, each with when it lapses on its own (Infinity: never). */
const holds = new Map<string, number>();

/**
 * Keeps a reload from happening while `reason` holds: an edit made but not yet handed
 * to a save, or one that neither this device nor the server could store. `forMs` lets
 * it lapse on its own, for when nothing may come to release it.
 */
export function hold(reason: string, on: boolean, forMs = Number.POSITIVE_INFINITY) {
  if (on) holds.set(reason, Date.now() + forMs);
  else holds.delete(reason);
}

/** Whether some reason still keeps a reload from happening. */
export function held(): boolean {
  const now = Date.now();
  for (const [reason, until] of holds) if (until <= now) holds.delete(reason);
  return holds.size > 0;
}

/** Marks a save in progress (on this device or to the server); a reload waits for it. */
export function saving<T>(p: Promise<T>): Promise<T> {
  inFlight.add(p);
  const done = () => inFlight.delete(p);
  p.then(done, done);
  return p;
}

/**
 * True while reloading would throw away what the user is doing: typing, a sheet or a
 * bubble open (their drafts live only in memory), a block being dragged.
 */
export function busy(doc: Document): boolean {
  const el = doc.activeElement;
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
  return !!doc.querySelector('[role="dialog"], .bubble-card, .pill.dragging');
}

/**
 * Shows a new deploy on this launch instead of the next one. The worker installs it in
 * the background and takes over; this reloads the page once the user is not in the
 * middle of anything and every save has landed, whether the app is on screen or not.
 * iOS resumes an installed app without a navigation, so coming back to it also checks
 * for a new version.
 */
export function watchUpdates(win: Window = window, reload = () => win.location.reload()) {
  const sw = win.navigator.serviceWorker;
  if (!sw) return;
  const doc = win.document;
  // The first install also takes control, but there is no old version to replace.
  let controlled = !!sw.controller;
  let pending = false;
  let settled = false;
  let trying = false;
  let retry: number | undefined;
  const attempt = async () => {
    if (!pending || !settled || trying || held() || busy(doc)) return;
    trying = true;
    try {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    } finally {
      trying = false;
    }
    // The user may have started something while the saves finished.
    if (!pending || held() || busy(doc)) return;
    pending = false;
    win.clearInterval(retry);
    reload();
  };
  sw.addEventListener("controllerchange", () => {
    const replaced = controlled;
    controlled = true;
    if (!replaced || pending) return;
    pending = true;
    win.setTimeout(() => {
      settled = true;
      void attempt();
    }, SETTLE_MS);
    retry = win.setInterval(() => void attempt(), RETRY_MS);
  });
  doc.addEventListener("visibilitychange", () => {
    if (doc.visibilityState === "hidden") void attempt();
    else
      void sw
        .getRegistration()
        .then((r) => r?.update())
        .catch(() => undefined);
  });
}
