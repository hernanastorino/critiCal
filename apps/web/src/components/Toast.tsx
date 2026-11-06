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

/** One notice for the whole app: the same look, tone and time everywhere (SPEC §14). */
export interface Toast {
  message: string;
  undo?: () => void;
  /** Lets its owner take it back (a plan change makes a drop's undo stale). */
  tag?: unknown;
}

interface ToastApi {
  show: (message: string, opts?: { undo?: () => void; tag?: unknown }) => void;
  /** Takes the notice away, only if it is still the one tagged `tag` when given. */
  clear: (tag?: unknown) => void;
  current: Toast | null;
  /** A standing notice the week keeps on screen (its critical summary). */
  setPinned: (node: ReactNode) => void;
}

/** How long a notice stays: longer when it offers to undo. */
export const TOAST_MS = 2500;
export const UNDO_MS = 6000;

const Ctx = createContext<ToastApi | null>(null);

/** Outside a provider (a screen tested alone) notices go nowhere. */
const quiet: ToastApi = { show: () => {}, clear: () => {}, current: null, setPinned: () => {} };

export const useToast = () => useContext(Ctx) ?? quiet;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Toast | null>(null);
  const [pinned, setPinned] = useState<ReactNode>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // It stays while the pointer or the keyboard is on it (SPEC §14).
  const held = useRef(false);
  const startTimer = useCallback((t: Toast) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () => {
        if (!held.current) setCurrent((c) => (c === t ? null : c));
      },
      t.undo ? UNDO_MS : TOAST_MS,
    );
  }, []);
  const show = useCallback<ToastApi["show"]>(
    (message, opts) => {
      const t = { message, ...opts };
      // A notice that left under the pointer never got its «leave»: start fresh.
      held.current = false;
      setCurrent(t);
      startTimer(t);
    },
    [startTimer],
  );
  const clear = useCallback<ToastApi["clear"]>((tag) => {
    setCurrent((c) => (tag === undefined || c?.tag === tag ? null : c));
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  const api = useMemo(() => ({ show, clear, current, setPinned }), [show, clear, current]);
  const release = () => {
    held.current = false;
    if (current) startTimer(current);
  };
  return (
    <Ctx.Provider value={api}>
      {children}
      {/* Above the tab bar; touches pass through everywhere but the notices. */}
      <div className="snacks" role="status">
        {pinned}
        {current && (
          // Holding it (pointer or keyboard on it) keeps it from going away: §14.
          // biome-ignore lint/a11y/noStaticElementInteractions: pausing a notice is not an action.
          <div
            className={`snack${current.undo ? " short" : ""}`}
            onPointerEnter={() => {
              held.current = true;
            }}
            onPointerLeave={release}
            onFocus={() => {
              held.current = true;
            }}
            onBlur={release}
          >
            <span>{current.message}</span>
            {current.undo && (
              <button
                type="button"
                className="btn small snack-btn"
                onClick={() => {
                  const was = current;
                  held.current = false;
                  was.undo?.();
                  // The undo may show a notice of its own: only this one goes.
                  setCurrent((c) => (c === was ? null : c));
                }}
              >
                Deshacer
              </button>
            )}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}
