// The trip of an event with no saved place, timed from home by its address or by hand: its
// minutes, to change or to forget (SPEC §6). The same spot as in «Lugares».
import type { AppEvent } from "../model.js";
import { eventSpotKey } from "../places.js";
import { useStore } from "../store.js";
import { MinutesInput } from "./Places.js";
import { PLAN_KEYS, useUndoable } from "./useUndoable.js";

/** Minutes the plan reserves to get to `event` from home, when they are a spot's. */
export function EventSpot({ event }: { event: AppEvent }) {
  const { data } = useStore();
  const undoable = useUndoable();
  const key = eventSpotKey(event);
  const spot = (data.spots ?? []).find((s) => s.key === key);
  if (!spot || spot.minutes === undefined) return null;
  const title = event.title.slice(0, 40);
  return (
    <div className="bubble-trip">
      <div className="row fields">
        <span className="meta" style={{ flex: 1 }}>
          Minutos desde casa
        </span>
        <MinutesInput
          label={`Minutos desde casa para ${title}`}
          value={spot.minutes}
          onCommit={(minutes) =>
            undoable(
              `Traslado de «${title}» cambiado`,
              { type: "spotMinutes", text: spot.text, minutes },
              [...PLAN_KEYS, "spots"],
            )
          }
        />
        <button
          type="button"
          className="btn small"
          aria-label={`Olvidar el traslado de ${title}`}
          onClick={() =>
            undoable(`Traslado de «${title}» olvidado`, { type: "forgetSpot", key }, [
              ...PLAN_KEYS,
              "spots",
              "eventTravel",
            ])
          }
        >
          Olvidar
        </button>
      </div>
    </div>
  );
}
