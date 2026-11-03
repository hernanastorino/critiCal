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
  return (
    <>
      <button type="button" className="scrim dim top" aria-label="Cancelar" onClick={onCancel} />
      <div className="action-sheet" role="dialog" aria-modal="true" aria-label={title}>
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
        <button type="button" className="action cancel" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </>
  );
}
