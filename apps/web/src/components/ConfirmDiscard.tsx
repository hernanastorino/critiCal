import { useRef } from "react";
import { useModal } from "./modal.js";

/**
 * «¿Descartar los cambios?»: asked when a form with unsaved changes is closed (✕, Escape,
 * the backdrop, pulling it down). Focus starts on «Seguir editando» and so does Escape:
 * an extra Enter or a stray tap never throws away what was typed.
 */
export function ConfirmDiscard({
  onDiscard,
  onKeep,
}: {
  onDiscard: () => void;
  onKeep: () => void;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const justOpened = useModal(sheet, onKeep);
  return (
    <>
      {/* For taps; the keyboard and VoiceOver have «Seguir editando» and Escape. */}
      <button
        type="button"
        className="scrim dim top"
        aria-hidden="true"
        tabIndex={-1}
        onClick={() => {
          if (!justOpened()) onKeep();
        }}
      />
      <div
        ref={sheet}
        className="action-sheet"
        role="alertdialog"
        aria-modal="true"
        aria-label="¿Descartar los cambios?"
      >
        <div className="action-group">
          <div className="action-head">
            <b className="action-title">¿Descartar los cambios?</b>
            <span>Lo que escribiste y no guardaste se pierde.</span>
          </div>
          <button type="button" className="action danger" onClick={onDiscard}>
            Descartar
          </button>
        </div>
        <button type="button" className="action cancel" data-autofocus onClick={onKeep}>
          Seguir editando
        </button>
      </div>
    </>
  );
}
