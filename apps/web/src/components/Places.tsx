import { useState } from "react";
import { useSync } from "../Connected.js";
import { CRITICAL, newId, type Place } from "../model.js";
import { minutesBetween } from "../places.js";
import { computeTravel } from "../remote.js";
import { useStore } from "../store.js";

const blank = (): Place => ({ id: newId(), name: "", aliases: [] });

/** Saved places and the driving times between them. */
export function Places() {
  const { data, dispatch } = useStore();
  const sync = useSync();
  const places = data.places ?? [];
  const [editing, setEditing] = useState<Place | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const compute = async () => {
    if (!sync) return;
    setBusy(true);
    setNote(null);
    const r = await computeTravel(sync.client);
    setBusy(false);
    if (!r.ok) {
      setNote(
        r.error === "server_not_configured"
          ? "Falta la clave de OpenRouteService en el servidor: cargá los tiempos a mano."
          : "No se pudieron calcular los tiempos. Probá de nuevo más tarde.",
      );
      return;
    }
    setNote(`Listo: ${r.pairs ?? 0} tiempos calculados.`);
    await sync.syncNow();
  };

  return (
    <details className="card prefs">
      <summary className="title">Lugares y traslados</summary>
      <p className="meta">
        Con tu casa guardada, el plan reserva el viaje (más el margen) antes y después de cada
        evento con ubicación. Los alias son otras formas en que el lugar aparece en tus eventos.
      </p>
      {places.map((p) => (
        <div key={p.id} className="check">
          <span style={{ flex: 1 }}>
            {p.isHome ? "🏠 " : ""}
            {p.name}
            {p.aliases.length > 0 && (
              <span className="meta" style={{ margin: 0 }}>
                {" "}
                · {p.aliases.join(", ")}
              </span>
            )}
          </span>
          <button type="button" className="btn" onClick={() => setEditing(p)}>
            Editar
          </button>
        </div>
      ))}
      {editing ? (
        <PlaceForm
          key={editing.id}
          place={editing}
          onCancel={() => setEditing(null)}
          onSave={(place) => {
            dispatch({ type: "savePlace", place });
            setEditing(null);
          }}
          onDelete={
            places.some((p) => p.id === editing.id)
              ? () => {
                  dispatch({ type: "deletePlace", placeId: editing.id });
                  setEditing(null);
                }
              : undefined
          }
        />
      ) : (
        <button
          type="button"
          className="btn"
          style={{ width: "100%" }}
          onClick={() => setEditing(blank())}
        >
          Agregar lugar
        </button>
      )}

      {places.length > 1 && (
        <>
          <div className="title" style={{ marginTop: 12 }}>
            Minutos en auto
          </div>
          {places.flatMap((from) =>
            places
              .filter((to) => to.id !== from.id)
              .map((to) => {
                const auto = (data.travelTimes ?? []).find(
                  (t) => t.from === from.id && t.to === to.id,
                );
                return (
                  <label
                    // Remount when the stored time changes (e.g. after computing), so the
                    // uncontrolled input shows it.
                    key={`${from.id}>${to.id}:${minutesBetween(data, from.id, to.id) ?? ""}`}
                    className="check"
                  >
                    <span style={{ flex: 1 }}>
                      {from.name} → {to.name}
                      {auto && !auto.manual && (
                        <span className="meta" style={{ margin: 0 }}>
                          {" "}
                          · calculado
                        </span>
                      )}
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      aria-label={`Minutos de ${from.name} a ${to.name}`}
                      style={{ width: 72 }}
                      defaultValue={minutesBetween(data, from.id, to.id) ?? ""}
                      onBlur={(e) => {
                        const minutes = Number(e.target.value);
                        if (
                          e.target.value !== "" &&
                          minutes >= 0 &&
                          minutes !== minutesBetween(data, from.id, to.id)
                        )
                          dispatch({ type: "travelTime", from: from.id, to: to.id, minutes });
                      }}
                    />
                  </label>
                );
              }),
          )}
          {sync && (
            <button
              type="button"
              className="btn"
              style={{ width: "100%" }}
              disabled={busy}
              onClick={() => void compute()}
            >
              {busy ? "Calculando…" : "Calcular con las direcciones"}
            </button>
          )}
          {note && (
            <p className="meta" style={note.startsWith("Listo") ? undefined : { color: CRITICAL }}>
              {note}
            </p>
          )}
        </>
      )}
    </details>
  );
}

function PlaceForm({
  place,
  onSave,
  onCancel,
  onDelete,
}: {
  place: Place;
  onSave: (p: Place) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(place.name);
  const [address, setAddress] = useState(place.address ?? "");
  const [aliases, setAliases] = useState(place.aliases.join(", "));
  const [isHome, setIsHome] = useState(!!place.isHome);
  return (
    <div className="card">
      <label className="field">
        <span>Nombre</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Facu" />
      </label>
      <label className="field">
        <span>Dirección (para calcular tiempos)</span>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Julio Herrera y Reissig 565, Montevideo"
        />
      </label>
      <label className="field">
        <span>Alias, separados por coma</span>
        <input
          value={aliases}
          onChange={(e) => setAliases(e.target.value)}
          placeholder="FING, Facultad"
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={isHome} onChange={(e) => setIsHome(e.target.checked)} />
        <span>Es mi casa</span>
      </label>
      <div className="row">
        <button
          type="button"
          className="btn primary"
          disabled={!name.trim()}
          onClick={() =>
            onSave({
              ...place,
              name: name.trim(),
              address: address.trim() || undefined,
              // A new address needs geocoding again.
              ...(address.trim() !== (place.address ?? "")
                ? { lat: undefined, lon: undefined }
                : {}),
              aliases: aliases
                .split(",")
                .map((a) => a.trim())
                .filter(Boolean),
              isHome: isHome || undefined,
            })
          }
        >
          Guardar
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
        {onDelete && (
          <button type="button" className="btn" onClick={onDelete}>
            Borrar
          </button>
        )}
      </div>
    </div>
  );
}
