import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Roy, type RoyAnim } from "./Roy.js";

/** One notice for the whole app: the same look, tone and time everywhere (SPEC §14). */
export interface Toast {
  message: string;
  undo?: () => void;
  /** Lets its owner take it back (a plan change makes a drop's undo stale). */
  tag?: unknown;
  /** Roy at the left of the text, in this shape: plays once and stays still (SPEC §18.1). */
  roy?: RoyAnim;
  /** «alert»: a refusal or an error, drawn in red. Anything else is neutral. */
  tone?: "alert";
  /** The message with its names whole: the notice shows them cut, this is its `title`. */
  full?: string;
}

interface ToastApi {
  show: (
    message: string,
    opts?: { undo?: () => void; tag?: unknown; roy?: RoyAnim; tone?: "alert"; full?: string },
  ) => void;
  /** Takes the notice away, only if it is still the one tagged `tag` when given. */
  clear: (tag?: unknown) => void;
  current: Toast | null;
  /** A standing notice the week keeps on screen (its critical summary). */
  setPinned: (node: ReactNode) => void;
}

/** How long a notice stays: longer when it offers to undo. */
export const TOAST_MS = 2500;
export const UNDO_MS = 8000;

const Ctx = createContext<ToastApi | null>(null);

/** Outside a provider (a screen tested alone) notices go nowhere. */
const quiet: ToastApi = { show: () => {}, clear: () => {}, current: null, setPinned: () => {} };

export const useToast = () => useContext(Ctx) ?? quiet;

/** Text larger than this share of the default (16 px) counts as large (SPEC §18.12). */
export const LARGE_TEXT = 1.5;

/** Whether the root font is past 150 % (the system text size: Dynamic Type on iOS). */
const largeNow = () =>
  typeof window !== "undefined" &&
  Number.parseFloat(getComputedStyle(document.documentElement).fontSize) > 16 * LARGE_TEXT;

/** Whether the system text size is large, kept up to date. */
export function useLargeText(): boolean {
  const [big, setBig] = useState(largeNow);
  useEffect(() => {
    // The size changes in the system settings, away from the app: check on coming back.
    const check = () => {
      setBig(largeNow());
    };
    window.addEventListener("resize", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.removeEventListener("resize", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  return big;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Toast | null>(null);
  const [pinned, setPinned] = useState<ReactNode>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // It stays while the pointer or the keyboard is on it (SPEC §14).
  // Two holds, kept apart: the notice goes only once neither the pointer nor focus is on it.
  const hover = useRef(false);
  const focus = useRef(false);
  /** Where keyboard focus was before it went to the notice: «Deshacer» gives it back there. */
  const cameFrom = useRef<HTMLElement | null>(null);
  const startTimer = useCallback((t: Toast) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () => {
        if (!(hover.current || focus.current)) setCurrent((c) => (c === t ? null : c));
      },
      t.undo ? UNDO_MS : TOAST_MS,
    );
  }, []);
  const show = useCallback<ToastApi["show"]>((message, opts) => {
    const t = { message, ...opts };
    setCurrent(t);
  }, []);
  const clear = useCallback<ToastApi["clear"]>((tag) => {
    setCurrent((c) => (tag === undefined || c?.tag === tag ? null : c));
  }, []);
  const box = useRef<HTMLDivElement>(null);
  // Held is what the page says after each change, not what events said: Firefox fires no
  // blur for a removed button, and React may keep a focused «Deshacer» for the next notice.
  useEffect(() => {
    const el = box.current;
    hover.current = !!current && !!el && el.matches(":hover");
    focus.current = !!current && !!el && el.contains(document.activeElement);
    if (!focus.current) cameFrom.current = null;
    if (current && !(hover.current || focus.current)) startTimer(current);
  }, [current, startTimer]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const api = useMemo(() => ({ show, clear, current, setPinned }), [show, clear, current]);
  const release = (which: { current: boolean }) => {
    which.current = false;
    if (current && !(hover.current || focus.current)) startTimer(current);
  };
  // It can sit over a button: tapping it (not its «Deshacer») puts it away.
  const tapAway = (e: React.MouseEvent) => {
    if (!(e.target instanceof Element && e.target.closest("button"))) setCurrent(null);
  };
  const takeFocus = (e: React.FocusEvent<HTMLElement>) => {
    focus.current = true;
    const from = e.relatedTarget;
    if (!(from instanceof HTMLElement && e.currentTarget.contains(from))) {
      cameFrom.current = from instanceof HTMLElement ? from : null;
    }
  };
  const undo = (was: Toast) => {
    const back = cameFrom.current;
    was.undo?.();
    // The notice goes away with the focus on it: back to where it was.
    setTimeout(() => {
      if (back?.isConnected && !back.closest("[inert]")) back.focus();
    }, 0);
    // The undo may show a notice of its own: only this one goes.
    setCurrent((c) => (c === was ? null : c));
  };
  const noticeBox = (
    <div className="toasts low">
      {/* Its own region: a new notice is announced alone, not with the standing summary. */}
      <div role="status">
        {current && (
          // Holding it (pointer or keyboard on it) keeps it from going away: §14.
          // biome-ignore lint/a11y/noStaticElementInteractions: pausing a notice is not an action.
          // biome-ignore lint/a11y/useKeyWithClickEvents: a tap only puts it away early; it goes by itself.
          <div
            ref={box}
            className={`snack${current.tone === "alert" ? " alert" : ""}`}
            onClick={tapAway}
            onPointerEnter={() => {
              hover.current = true;
            }}
            onPointerLeave={() => release(hover)}
            onFocus={takeFocus}
            onBlur={() => release(focus)}
          >
            {current.roy && <Roy anim={current.roy} size={56} maxWidth={72} once />}
            <span className="snack-text" title={current.full}>
              {current.message}
            </span>
            {current.undo && (
              <button type="button" className="btn small snack-btn" onClick={() => undo(current)}>
                Deshacer
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
  return (
    <Ctx.Provider value={api}>
      {children}
      {/* Notice and standing summary share one column above the tab bar: the notice over the
          summary, so they never overlap and no notice covers a header or a title. With a sheet
          open the notice goes to the strip the sheet leaves free, at the top (styles.css). */}
      <div className="snacks stacked">
        {noticeBox}
        <div role="status">{pinned}</div>
      </div>
    </Ctx.Provider>
  );
}
