import { type ReactNode, useEffect, useState } from "react";

/** A wait shorter than this needs no words (SPEC §14). */
export const WAIT_MS = 1000;

/** True once `ms` have passed since it was mounted (immediately when `ms` is 0). */
export function useAfter(ms: number): boolean {
  const [late, setLate] = useState(ms <= 0);
  useEffect(() => {
    if (ms <= 0) return;
    const id = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(id);
  }, [ms]);
  return late;
}

/**
 * What the app is doing while the user waits: «Calculando traslados 3 de 8…», with a bar
 * when the total is known. `done` counts what is finished, the text names the one in
 * progress. Silent for the first second, so quick loads do not flash a message.
 */
export function Wait({
  label,
  done,
  total,
  delay = WAIT_MS,
}: {
  label: string;
  done?: number;
  total?: number;
  delay?: number;
}) {
  const late = useAfter(delay);
  if (!late) return null;
  const known = total !== undefined && total > 0 && done !== undefined;
  const current = known ? Math.min(done + 1, total) : 0;
  return (
    <div className="wait" role="status">
      <span>{known ? `${label} ${current} de ${total}…` : `${label}…`}</span>
      {known && (
        <div
          className="wait-bar"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={Math.min(done, total)}
        >
          <span style={{ width: `${Math.min(100, Math.round((done / total) * 100))}%` }} />
        </div>
      )}
    </div>
  );
}

/**
 * An error says what happened and gives the button to do something about it (SPEC §14).
 * Without an action it is only for what nothing on this screen can fix.
 */
export function ErrorNote({
  children,
  action,
  testId,
}: {
  children: ReactNode;
  action?: { label: string; onClick: () => void; disabled?: boolean };
  testId?: string;
}) {
  return (
    <div className="error-note" role="alert">
      <p data-testid={testId}>{children}</p>
      {action && (
        <button
          type="button"
          className="btn small"
          disabled={action.disabled}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/** A grey stand-in for text or a block that is still loading. */
export function Skeleton({ width, height }: { width?: string; height?: string }) {
  return (
    <div
      className="skeleton"
      aria-hidden="true"
      style={width || height ? { width, height } : undefined}
    />
  );
}

/** A screen's shape while its content loads: a title and a few cards. */
export function ScreenSkeleton({ label }: { label: string }) {
  return (
    <div className="screen" aria-busy="true">
      <div className="header">
        <Skeleton width="40%" height="28px" />
      </div>
      <div className="scroll">
        <div className="sr-only" role="status">
          {label}
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="card skeleton-card">
            <Skeleton width="55%" height="16px" />
            <Skeleton height="12px" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The app's shape while it opens: header, a week of day columns and the tab bar. With a
 * `label` it says what is being done (shown at once: opening is already a wait).
 */
export function AppSkeleton({ label }: { label?: string }) {
  return (
    <div className="app" aria-busy="true">
      <div className="screen">
        <div className="header">
          <Skeleton width="45%" height="28px" />
        </div>
        <div className="scroll">
          {label && <Wait label={label} delay={0} />}
          <div className="skeleton-week" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <div key={d} className="skeleton-day">
                <Skeleton height="14px" />
                <Skeleton height={`${40 + ((d * 23) % 60)}px`} />
                <Skeleton height={`${30 + ((d * 37) % 50)}px`} />
              </div>
            ))}
          </div>
        </div>
      </div>
      <nav className="tabs skeleton-tabs" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i}>
            <Skeleton width="24px" height="24px" />
            <Skeleton width="36px" height="10px" />
          </span>
        ))}
      </nav>
    </div>
  );
}
