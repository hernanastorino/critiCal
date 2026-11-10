import type { ReactNode } from "react";

/** One thing the user can do about a problem: always a button, never "try later". */
export interface NoticeAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

/**
 * A problem told plainly (SPEC §14, §18.1): what happened, then what to do now, with
 * the buttons to do it. `mascot` is the empty slot for the character; nothing is drawn
 * there until one is chosen.
 */
export function Notice({
  title,
  message,
  actions = [],
  mascot,
  tone = "warn",
}: {
  title?: string;
  message: ReactNode;
  actions?: NoticeAction[];
  mascot?: ReactNode;
  tone?: "warn" | "error";
}) {
  return (
    <div className={`notice ${tone}`} role="alert">
      {mascot && <div className="notice-mascot">{mascot}</div>}
      {title && <div className="title">{title}</div>}
      <p className="meta">{message}</p>
      {actions.length > 0 && (
        <div className="row">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              className={`btn small${a.primary ? " primary" : ""}`}
              onClick={a.onClick}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
