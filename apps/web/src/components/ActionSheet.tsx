import { useRef } from "react";
import { useModal } from "./modal.js";

export interface SheetOption {
  label: string;
  detail?: string;
  danger?: boolean;
  onPick: () => void;
}

/** iOS-style choice sheet: a titled group of options and a separate Cancel. */
export function ActionSheet({
  title,
  message,
  options,
  onCancel,
}: {
  title: string;
  message?: string;
  options: SheetOption[];
  onCancel: () => void;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const justOpened = useModal(sheet, onCancel);
  return (
    <>
      {/* For taps; the keyboard and VoiceOver have «Cancelar» and Escape. */}
      <button
        type="button"
        className="scrim dim top"
        aria-hidden="true"
        tabIndex={-1}
        onClick={() => {
          if (!justOpened()) onCancel();
        }}
      />
      <div ref={sheet} className="action-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="action-group">
          <div className="action-head">
            <b className="action-title">{title}</b>
            {message && <span>{message}</span>}
          </div>
          {options.map((o) => (
            <button
              key={o.label}
              type="button"
              className={`action${o.danger ? " danger" : ""}`}
              onClick={o.onPick}
            >
              {o.label}
              {o.detail && <small>{o.detail}</small>}
            </button>
          ))}
        </div>
        {/* Focus starts here: an extra Enter must not delete anything. */}
        <button type="button" className="action cancel" data-autofocus onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </>
  );
}
