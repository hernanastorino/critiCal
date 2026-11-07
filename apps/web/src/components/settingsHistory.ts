import { useEffect, useRef } from "react";

/** Ajustes open on its list is history entry 1; on one of its screens, entry 2. */
const KEY = "critiCal.settings";
const level = () => (history.state as Record<string, number> | null)?.[KEY];

interface Handlers {
  onList: () => void;
  onClose: () => void;
}
/** The open sheet (React's dev remount unmounts and mounts one at once). */
let current: { current: Handlers } | null = null;
let live = 0;
/** Pops of our own making, which the sheet has already handled or does not need to. */
let own = 0;

if (typeof window !== "undefined") {
  // A reload keeps the entry's state, but the sheet that owned it is gone.
  if (level() !== undefined) history.replaceState(null, "");
  window.addEventListener("popstate", () => {
    if (own > 0) {
      own--;
      // Closed and opened again before the pop landed: its entry went with it.
      if (current && level() === undefined) history.pushState({ [KEY]: 1 }, "");
      return;
    }
    // An entry left by a sheet that a reload closed: nothing to show, so go past it.
    if (!current) {
      if (level() !== undefined) history.back();
      return;
    }
    const l = level();
    if (l === 1) current.current.onList();
    else if (l === undefined) current.current.onClose();
  });
}

/**
 * The system's back (button, swipe) goes from a screen of Ajustes to its list and from
 * the list to the app, instead of leaving the app. Closing any other way takes the
 * entries it added off again, so «atrás» never lands on an Ajustes that is not there.
 * `popScreen` is for the sheet's own «Volver»: it takes the screen's entry off, and the
 * sheet shows the list itself.
 */
export function useSettingsHistory(page: unknown, onList: () => void, onClose: () => void) {
  const handlers = useRef<Handlers>({ onList, onClose });
  handlers.current = { onList, onClose };

  useEffect(() => {
    live++;
    current = handlers;
    // Settled right away: the pending pops of an earlier sheet are what is in flight.
    if (level() === undefined && own === 0) history.pushState({ [KEY]: 1 }, "");
    return () => {
      live--;
      setTimeout(() => {
        if (live > 0) return;
        current = null;
        const l = level();
        if (!l) return;
        own++;
        history.go(-l);
      }, 0);
    };
  }, []);

  useEffect(() => {
    if (page && level() !== 2) history.pushState({ [KEY]: 2 }, "");
  }, [page]);

  return () => {
    if (level() !== 2) return;
    own++;
    history.back();
  };
}
