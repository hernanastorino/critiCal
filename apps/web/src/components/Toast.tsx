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
  /** A notice that goes in place of the older one with the same key (a delete in a row). */
  replaces?: unknown;
}

interface ToastApi {
  show: (
    message: string,
    opts?: {
      undo?: () => void;
      tag?: unknown;
      roy?: RoyAnim;
      tone?: "alert";
      full?: string;
      replaces?: unknown;
    },
  ) => void;
  /** Takes the notice away, only if it is still the one tagged `tag` when given. */
  clear: (tag?: unknown) => void;
  current: Toast | null;
  /** A standing notice the week keeps on screen (its critical summary). */
  setPinned: (node: ReactNode) => void;
}

/** How long a notice stays: longer when it offers to undo. */
export const TOAST_MS = 2500;
export const UNDO_MS = 4000;

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

/** A notice on screen, with the number that tells it from the others. */
type Shown = Toast & { id: number };

/** Notices that offer «Deshacer» pile up (a second one must not take the first one's away). */
const MAX_UNDOABLE = 2;

/** A finger leaves no hover behind (WebKit keeps :hover after a tap): only count it with a mouse. */
const hovers = () =>
  typeof window.matchMedia !== "function" || !window.matchMedia("(hover: none)").matches;

/** One notice: it stays while the pointer or the keyboard is on it (SPEC §14), then goes by itself. */
function Snack({
  toast,
  onDone,
  onUndo,
}: {
  toast: Shown;
  onDone: (id: number) => void;
  onUndo: (t: Shown, back: HTMLElement | null) => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Two holds, kept apart: the notice goes only once neither the pointer nor focus is on it.
  const hover = useRef(false);
  const focus = useRef(false);
  /** Where keyboard focus was before it went to the notice: «Deshacer» gives it back there. */
  const cameFrom = useRef<HTMLElement | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const startTimer = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () => {
        if (!(hover.current || focus.current)) onDone(toast.id);
      },
      toast.undo ? UNDO_MS : TOAST_MS,
    );
  }, [toast, onDone]);
  // Held is what the page says when it appears, not what events said.
  useEffect(() => {
    const el = box.current;
    hover.current = !!el && hovers() && el.matches(":hover");
    focus.current = !!el && el.contains(document.activeElement);
    if (!(hover.current || focus.current)) startTimer();
    return () => clearTimeout(timer.current);
  }, [startTimer]);
  const release = (which: { current: boolean }) => {
    which.current = false;
    if (!(hover.current || focus.current)) startTimer();
  };
  const takeFocus = (e: React.FocusEvent<HTMLElement>) => {
    focus.current = true;
    const from = e.relatedTarget;
    if (!(from instanceof HTMLElement && e.currentTarget.contains(from))) {
      cameFrom.current = from instanceof HTMLElement ? from : null;
    }
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: pausing a notice is not an action.
    <div
      ref={box}
      className={`snack${toast.tone === "alert" ? " alert" : ""}`}
      onPointerEnter={(e) => {
        hover.current = e.pointerType !== "touch";
      }}
      onPointerLeave={() => release(hover)}
      onFocus={takeFocus}
      onBlur={() => release(focus)}
    >
      {toast.roy && <Roy anim={toast.roy} size={56} maxWidth={72} once />}
      <span className="snack-text" title={toast.full}>
        {toast.message}
      </span>
      {toast.undo && (
        <button
          type="button"
          className="btn small snack-btn"
          onClick={() => onUndo(toast, cameFrom.current)}
        >
          Deshacer
        </button>
      )}
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Shown[]>([]);
  const [pinned, setPinned] = useState<ReactNode>(null);
  const count = useRef(0);
  const current = list.at(-1) ?? null;
  const show = useCallback<ToastApi["show"]>((message, opts) => {
    count.current += 1;
    const t: Shown = { message, ...opts, id: count.current };
    // A plain notice replaces what was there; one with «Deshacer» only piles on the others'.
    const kept = (x: Shown) => x.undo && (t.replaces === undefined || x.replaces !== t.replaces);
    setList((l) => (t.undo ? [...l.filter(kept), t].slice(-MAX_UNDOABLE) : [t]));
  }, []);
  const clear = useCallback<ToastApi["clear"]>((tag) => {
    setList((l) => (tag === undefined ? [] : l.filter((x) => x.tag !== tag)));
  }, []);
  const done = useCallback((id: number) => {
    setList((l) => l.filter((x) => x.id !== id));
  }, []);
  const undo = useCallback(
    (was: Shown, back: HTMLElement | null) => {
      was.undo?.();
      // The notice goes away with the focus on it: back to where it was.
      setTimeout(() => {
        if (back?.isConnected && !back.closest("[inert]")) back.focus();
      }, 0);
      // The undo may show a notice of its own: only this one goes.
      done(was.id);
    },
    [done],
  );
  const api = useMemo(() => ({ show, clear, current, setPinned }), [show, clear, current]);
  const noticeBox = (
    <div className="toasts low">
      {/* Its own region: a new notice is announced alone, not with the standing summary. */}
      <div role="status">
        {list.map((t) => (
          <Snack key={t.id} toast={t} onDone={done} onUndo={undo} />
        ))}
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
