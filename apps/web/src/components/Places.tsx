import { useEffect, useId, useRef, useState } from "react";
import { useSync } from "../Connected.js";
import { useDraft } from "../drafts.js";
import { dayDate } from "../format.js";
import { BACKUP_TEXT_MAX, NAME_MAX } from "../limits.js";
import { CRITICAL, newId, type Place, type Spot } from "../model.js";
import {
  keepableEvents,
  keptTravel,
  minutesBetween,
  nameTaken,
  type PlacePair,
  tripPairs,
} from "../places.js";
import { computeTravel } from "../remote.js";
import { useStore } from "../store.js";
import { Loading } from "./Loading.js";
import { Section } from "./Section.js";
import { useToast } from "./Toast.js";

const blank = (): Place => ({ id: newId(), name: "", aliases: [] });

/** Saved places and the driving times between them. */
export function Places() {
  const { data, now, dispatch } = useStore();
  const sync = useSync();
  const places = data.places ?? [];
  const [editing, setEditing] = useDraft<Place | null>("places:editing", () => null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // The last try failed for a reason that trying again can fix.
  const [retry, setRetry] = useState(false);
  const toast = useToast();
  const kept = data.events.flatMap((event) => {
    const minutes = keptTravel(data, event);
    return minutes === undefined ? [] : [{ event, minutes }];
  });

  // Only the trips that exist: the ones with a time (computed when the plan needed them,
  // or typed) and the ones the plan makes that still lack one. Never every combination.
  const trips: PlacePair[] = [];
  {
    const known = new Set(places.map((p) => p.id));
    const seen = new Set<string>();
    const add = (t: PlacePair) => {
      const key = `${t.from}>${t.to}`;
      if (seen.has(key) || !known.has(t.from) || !known.has(t.to)) return;
      seen.add(key);
      trips.push({ from: t.from, to: t.to });
    };
    for (const t of data.travelTimes ?? []) add(t);
    for (const t of tripPairs(data, now)) add(t);
  }
  /** Saves a place; marking another as home says so and offers to go back to the old one. */
  const savePlace = (place: Place) => {
    const before = places.find((p) => p.isHome && p.id !== place.id);
    dispatch({ type: "savePlace", place });
    if (!place.isHome || !before) return;
    toast.show(`Ahora tu casa es ${short(place.name)}`, {
      undo: () => dispatch({ type: "savePlace", place: before }),
    });
  };
  const placeName = (id: string) => places.find((p) => p.id === id)?.name ?? "?";
  const eventSpots = (data.spots ?? []).length + kept.length;

  const compute = async () => {
    if (!sync) return;
    setBusy(true);
    setNote(null);
    setRetry(false);
    // An address just edited must reach the database before the server reads it.
    if (!(await sync.flush())) {
      setBusy(false);
      setRetry(true);
      setNote("Hay cambios sin guardar (¿sin conexión?). Reintentá cuando se sincronicen.");
      return;
    }
    // The trips listed here, not every pair of places.
    const r = await computeTravel(sync.client, trips);
    setBusy(false);
    if (!r.ok) {
      setRetry(r.error !== "server_not_configured" && r.error !== "unauthorized");
      setNote(
        r.error === "server_not_configured"
          ? "Falta la clave de OpenRouteService en el servidor: cargá los tiempos a mano."
          : r.error === "unauthorized"
            ? "Se venció tu sesión. Volvé a iniciar sesión y calculá de nuevo, o cargá los minutos a mano."
            : "No pude calcular los tiempos ahora (el servicio de mapas no contestó). Reintentá, o cargá los minutos a mano.",
      );
      return;
    }
    const name = (id: string) => places.find((p) => p.id === id)?.name ?? "?";
    // Only pairs entered by hand are settled: computed times may be the ones the server
    // just deleted, and it already leaves manual pairs out of `unroutable`.
    const known = (from: string, to: string) =>
      (data.travelTimes ?? []).some((t) => t.manual && t.from === from && t.to === to);
    const incomplete = (id: string) =>
      trips.some((t) => (t.from === id || t.to === id) && !known(t.from, t.to));
    const missing = (r.unroutable ?? [])
      .filter((u) => !known(u.from, u.to))
      .map((u) => `${name(u.from)} → ${name(u.to)}`);
    const unknown = (r.ungeocoded ?? []).filter(incomplete).map(name);
    const noAddress = (r.noAddress ?? []).filter(incomplete).map(name);
    const problems = [
      noAddress.length ? `Sin dirección: ${noAddress.join(", ")}` : "",
      unknown.length ? `no encontré la dirección de ${unknown.join(", ")}` : "",
      missing.length ? `sin ruta en auto para ${missing.join(", ")}` : "",
    ].filter(Boolean);
    // Problems stay by the button; success is the app's one notice.
    if (problems.length) setNote(`${problems.join("; ")}: cargá esos minutos a mano.`);
    else toast.show(`${r.pairs ?? 0} tiempos calculados`);
    await sync.syncNow();
  };

  return (
    <Section>
      <p className="meta" id="places-intro" tabIndex={-1}>
        Con tu casa guardada, el plan reserva el viaje (más el margen) antes y después de cada
        evento con ubicación. Los alias son otras formas en que el lugar aparece en tus eventos.
      </p>
      {places.map((p) =>
        editing?.id === p.id ? (
          // The form opens where its place is, not at the end of the list.
          <PlaceForm
            key={p.id}
            place={editing}
            onCancel={() => setEditing(null)}
            onSave={(place) => {
              savePlace(place);
              setEditing(null);
              refocusPlace(place.id);
            }}
            onDelete={() => {
              const times = (data.travelTimes ?? []).filter(
                (t) => t.from === p.id || t.to === p.id,
              );
              dispatch({ type: "deletePlace", placeId: p.id });
              setEditing(null);
              toast.show(`${short(p.name)} borrado`, {
                undo: () => {
                  dispatch({ type: "savePlace", place: p });
                  // Its times typed by hand come back; computed ones are worked out again.
                  for (const t of times.filter((x) => x.manual))
                    dispatch({ type: "travelTime", from: t.from, to: t.to, minutes: t.minutes });
                },
              });
              refocus("places-intro");
            }}
          />
        ) : (
          <div key={p.id} id={`place-${p.id}`} tabIndex={-1} className="check place-row">
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="place-name">
                {p.isHome ? "🏠 " : ""}
                {p.name}
              </span>
              {p.aliases.length > 0 && (
                <span className="meta place-aliases">{p.aliases.join(", ")}</span>
              )}
            </span>
            <button
              type="button"
              className="btn small"
              aria-label={`Editar ${p.name}`}
              onClick={() => setEditing(p)}
            >
              Editar
            </button>
          </div>
        ),
      )}
      {editing && !places.some((p) => p.id === editing.id) ? (
        <PlaceForm
          key={editing.id}
          place={editing}
          onCancel={() => setEditing(null)}
          onSave={(place) => {
            savePlace(place);
            setEditing(null);
            refocusPlace(place.id);
          }}
        />
      ) : (
        <button
          type="button"
          id="add-place"
          className="btn"
          style={{ width: "100%", marginTop: 8 }}
          onClick={() => setEditing(blank())}
        >
          Agregar lugar
        </button>
      )}

      {eventSpots > 0 && (
        // Closed unless asked for: an address that already has its minutes needs nothing.
        <details className="fold">
          <summary>
            Direcciones de eventos <span className="meta">{eventSpots}</span>
          </summary>
          {(data.spots ?? []).length > 0 && (
            <>
              <p className="meta" id="spots" tabIndex={-1}>
                Se usan para el traslado sin guardarse como lugar. No hace falta hacer nada con
                ellas; guardá solo las que vayas a repetir.
              </p>
              {(data.spots ?? []).map((spot) => (
                <SpotRow key={spot.key} spot={spot} />
              ))}
            </>
          )}
          {kept.length > 0 && (
            <>
              <div className="title" style={{ marginTop: 12 }} id="kept-travel" tabIndex={-1}>
                Traslados de eventos sin dirección
              </div>
              <p className="meta">
                Minutos que quedaron al eliminar una dirección. El plan los sigue contando.
              </p>
              {kept.map(({ event, minutes }) => (
                <div key={event.id} className="check" style={{ flexWrap: "wrap" }}>
                  <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                    {event.title}
                    <span className="meta" style={{ margin: 0, whiteSpace: "nowrap" }}>
                      {" "}
                      · {dayDate(data.settings.timezone, event.start)}
                    </span>
                  </span>
                  <MinutesInput
                    label={`Minutos desde casa para ${short(event.title)}, ${dayDate(data.settings.timezone, event.start)}`}
                    value={minutes}
                    onCommit={(m) =>
                      dispatch({ type: "eventTravelMinutes", eventId: event.id, minutes: m })
                    }
                  />
                  <button
                    type="button"
                    className="btn small"
                    aria-label={`Olvidar el traslado de ${short(event.title)}, ${dayDate(data.settings.timezone, event.start)}`}
                    onClick={() => {
                      const before = data.eventTravel?.[event.id];
                      dispatch({ type: "eventTravelMinutes", eventId: event.id, minutes: null });
                      toast.show(`Traslado de ${short(event.title)} olvidado`, {
                        undo: () =>
                          before &&
                          dispatch({
                            type: "eventTravelMinutes",
                            eventId: event.id,
                            minutes: before.minutes,
                          }),
                      });
                    }}
                  >
                    Olvidar
                  </button>
                </div>
              ))}
            </>
          )}
        </details>
      )}

      {places.length > 1 && (
        <details className="fold">
          <summary>
            Minutos en auto <span className="meta">{trips.length}</span>
          </summary>
          <p className="meta">
            Se calculan solos cuando el plan necesita un viaje entre dos lugares. Acá están solo los
            que usás; corregí a mano el que esté mal.
          </p>
          {trips.map(({ from, to }) => {
            const auto = (data.travelTimes ?? []).find((t) => t.from === from && t.to === to);
            return (
              <div key={`${from}>${to}`} className="check" style={{ flexWrap: "wrap" }}>
                <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                  {placeName(from)} → {placeName(to)}
                  {auto && !auto.manual && <span className="meta place-aliases">calculado</span>}
                </span>
                <MinutesInput
                  label={`Minutos de ${placeName(from)} a ${placeName(to)}`}
                  value={minutesBetween(data, from, to)}
                  onCommit={(minutes) => dispatch({ type: "travelTime", from, to, minutes })}
                />
              </div>
            );
          })}
          {trips.length === 0 && <p className="meta">Todavía no hay ningún viaje entre lugares.</p>}
          <AddTrip
            places={places}
            onAdd={(from, to, minutes) => dispatch({ type: "travelTime", from, to, minutes })}
          />
          {sync && trips.length > 0 && (
            <button
              type="button"
              className="btn"
              style={{ width: "100%", marginTop: 8 }}
              disabled={busy}
              onClick={() => void compute()}
            >
              {busy ? "Calculando…" : retry ? "Reintentar" : "Calcular de nuevo"}
            </button>
          )}
          {busy && <Loading kind="travel" label="Calculando traslados entre tus lugares" inline />}
          {note && (
            <p className="meta" style={{ color: CRITICAL }}>
              {note}
            </p>
          )}
        </details>
      )}
    </Section>
  );
}

/** A driving time typed by hand for a trip that is not on the list yet. */
function AddTrip({
  places,
  onAdd,
}: {
  places: Place[];
  onAdd: (from: string, to: string, minutes: number) => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const name = (id: string) => places.find((p) => p.id === id)?.name ?? "?";
  const ready = !!from && !!to && from !== to;
  return (
    <fieldset className="add-trip">
      <legend className="meta">Cargar un tiempo a mano</legend>
      <select aria-label="Desde" value={from} onChange={(e) => setFrom(e.target.value)}>
        <option value="">Desde…</option>
        {places.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select aria-label="Hasta" value={to} onChange={(e) => setTo(e.target.value)}>
        <option value="">Hasta…</option>
        {places
          .filter((p) => p.id !== from)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </select>
      {ready && (
        <MinutesInput
          key={`${from}>${to}`}
          label={`Minutos nuevos de ${name(from)} a ${name(to)}`}
          value={undefined}
          onCommit={(minutes) => {
            onAdd(from, to, minutes);
            setFrom("");
            setTo("");
          }}
        />
      )}
    </fieldset>
  );
}

/**
 * Minutes field: shows the stored value until the user types; from then on their draft
 * wins, so a time computed meanwhile never replaces what is being typed, and an
 * untouched field never turns a computed time into a manual one.
 */
function MinutesInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number | undefined;
  onCommit: (minutes: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const errorId = useId();
  const commit = () => {
    if (draft === null) return;
    // Whole minutes up to a day: «12.5», «1e9» or «99999» would not even fit a backup.
    const n = Math.min(1440, Math.round(Number(draft.replace(",", "."))));
    if (/^\s*\d+(?:[.,]\d+)?\s*$/.test(draft)) {
      if (n !== value) onCommit(n);
    } else if (draft.trim() !== "") {
      // Not minutes: the field says so instead of quietly going back.
      setBad(true);
      return;
    }
    setBad(false);
    setDraft(null);
  };
  return (
    <>
      <input
        // Text, not number: Safari drops a decimal comma from number fields (12,5 → 125).
        type="text"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={bad ? true : undefined}
        aria-describedby={bad ? errorId : undefined}
        title={bad ? "Poné minutos de 0 a 1440, solo cifras" : undefined}
        style={{ width: 72, ...(bad ? { borderColor: "var(--critical)" } : {}) }}
        value={draft ?? value ?? ""}
        onChange={(e) => {
          setBad(false);
          setDraft(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      {bad && (
        <span
          className="meta"
          id={errorId}
          role="alert"
          // On a line of its own: next to the field it squeezed the row's name.
          style={{ color: "var(--critical)", margin: 0, width: "100%", order: 9 }}
        >
          Minutos de 0 a 1440, solo cifras.
        </span>
      )}
    </>
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
  const fresh = () => ({
    name: place.name,
    address: place.address ?? "",
    aliases: place.aliases.join(", "),
    isHome: !!place.isHome,
  });
  const [form, setForm, saved, dirty] = useDraft(`place:${place.id}`, fresh);
  const { name, address, aliases, isHome } = form;
  const setName = (v: string) => setForm({ ...form, name: v });
  const setAddress = (v: string) => setForm({ ...form, address: v });
  const setAliases = (v: string) => setForm({ ...form, aliases: v });
  const setIsHome = (v: boolean) => setForm({ ...form, isHome: v });
  // Done with the form: what was typed is not kept.
  const finish = () => saved(fresh());
  const { data } = useStore();
  const taken = nameTaken(data.places ?? [], name, place.id);
  // A tap on a greyed «Guardar» says why; an empty name is only an error after that.
  const [tried, setTried] = useState(false);
  const empty = !name.trim();
  const longAlias = aliases.split(",").some((a) => a.trim().length > BACKUP_TEXT_MAX);
  const problem = taken
    ? "Ya tenés un lugar con ese nombre: elegí otro o editá ese."
    : longAlias
      ? `Cada alias tiene como máximo ${BACKUP_TEXT_MAX} caracteres.`
      : empty && tried
        ? "Poné un nombre para el lugar."
        : null;
  const nameField = useRef<HTMLInputElement>(null);
  // Opened from «Agregar lugar» or «Editar»: the keyboard lands on the first field.
  useEffect(() => nameField.current?.focus(), []);
  return (
    <div className="card">
      <label className="field">
        <span>Nombre</span>
        <input
          ref={nameField}
          value={name}
          maxLength={NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          placeholder="Facu"
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `taken-${place.id}` : undefined}
        />
      </label>
      {problem && (
        <p
          className="meta"
          id={`taken-${place.id}`}
          role="alert"
          style={{ color: "var(--critical)" }}
        >
          {problem}
        </p>
      )}
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
      {/* Always there (empty until something changes), so the fields do not jump while typing. */}
      <p className="meta" style={{ margin: "6px 0 10px", minHeight: "1.2em" }}>
        {dirty ? "Cambios sin guardar" : ""}
      </p>
      <div className="row">
        <button
          type="button"
          className="btn primary"
          aria-disabled={empty || taken || longAlias ? true : undefined}
          onClick={() => {
            if (empty || taken || longAlias) {
              setTried(true);
              nameField.current?.focus();
              return;
            }
            finish();
            onSave({
              ...place,
              name: name.trim(),
              address: address.trim() || undefined,
              // A new address needs geocoding again.
              ...(address.trim() !== (place.address ?? "")
                ? { lat: undefined, lon: undefined }
                : {}),
              // «casa, CASA, casa» is one alias.
              aliases: aliases
                .split(",")
                .map((a) => a.trim())
                .filter(
                  (a, i, all) =>
                    a && all.findIndex((b) => b.toLowerCase() === a.toLowerCase()) === i,
                ),
              isHome: isHome || undefined,
            });
          }}
        >
          Guardar
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            finish();
            onCancel();
          }}
        >
          Cancelar
        </button>
      </div>
      {onDelete && (
        <button type="button" className="btn danger" style={{ width: "100%" }} onClick={onDelete}>
          Borrar lugar
        </button>
      )}
    </div>
  );
}

/** A label-sized piece of a long address or title (a 3000-character one is still read whole). */
const short = (s: string, max = 40) => (s.length > max ? `${s.slice(0, max)}…` : s);

/** After saving a place the keyboard goes to its row, or to «Agregar lugar». */
const refocusPlace = (id: string) =>
  requestAnimationFrame(() =>
    (document.getElementById(`place-${id}`) ?? document.getElementById("add-place"))?.focus(),
  );

/** After a row goes away, the keyboard stays nearby: on the section heading. */
const refocus = (id: string) =>
  requestAnimationFrame(() =>
    (
      document.getElementById(id) ??
      document.getElementById("spots") ??
      document.getElementById("kept-travel") ??
      // The last row went: the top of Lugares is always there.
      document.getElementById("places-intro")
    )?.focus(),
  );

/** An event address in use: its minutes from home, saving it as a place, or forgetting it. */
function SpotRow({ spot }: { spot: Spot }) {
  const { data, dispatch } = useStore();
  const toast = useToast();
  // «Eliminar lugar» keeps the minutes on the events that use it: with none, it would
  // just forget them, so it is not offered.
  const keepable = spot.minutes !== undefined && keepableEvents(data, spot.key).length > 0;
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const taken = nameTaken(data.places ?? [], name);
  const takenId = useId();
  const saveSpot = () => {
    if (name.trim() && !taken) dispatch({ type: "saveSpot", key: spot.key, name });
  };
  return (
    <div className="check" style={{ flexWrap: "wrap" }}>
      <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }} title={spot.text}>
        {short(spot.text, 120)}
        {spot.failed && (
          <span className="meta" style={{ margin: 0 }}>
            {" "}
            · no encontrada
          </span>
        )}
      </span>
      <MinutesInput
        label={`Minutos desde casa a ${short(spot.text)}`}
        value={spot.minutes}
        onCommit={(minutes) => dispatch({ type: "spotMinutes", text: spot.text, minutes })}
      />
      {naming ? (
        <div className="row" style={{ width: "100%" }}>
          <input
            aria-label={`Nombre para ${short(spot.text)}`}
            maxLength={NAME_MAX}
            // Opening «Guardar como lugar» goes straight to typing the name.
            ref={(el) => el?.focus()}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229) return;
              e.preventDefault();
              saveSpot();
            }}
            aria-invalid={taken ? true : undefined}
            aria-describedby={taken ? takenId : undefined}
            placeholder="Casa de Clara"
            style={{ flex: 1 }}
          />
          {taken && (
            <span
              className="meta"
              id={takenId}
              role="alert"
              style={{ width: "100%", color: "var(--critical)" }}
            >
              Ya tenés un lugar con ese nombre.
            </span>
          )}
          <button
            type="button"
            className="btn small"
            disabled={!name.trim() || taken}
            onClick={saveSpot}
          >
            Guardar
          </button>
        </div>
      ) : (
        <div className="row" style={{ flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn small"
            aria-label={`Guardar como lugar ${short(spot.text)}`}
            onClick={() => setNaming(true)}
          >
            Guardar como lugar
          </button>
          {keepable && (
            <button
              type="button"
              className="btn small"
              aria-label={`Eliminar lugar ${short(spot.text)}, conservando los minutos`}
              onClick={() => {
                const eventIds = keepableEvents(data, spot.key);
                const before = Object.fromEntries(
                  eventIds.map((id) => [id, data.eventTravel?.[id]]),
                );
                dispatch({ type: "dropSpotAddress", key: spot.key });
                toast.show(
                  `Dirección borrada · los ${spot.minutes} min de traslado quedan en ${eventIds.length === 1 ? "el evento" : "sus eventos"} y el plan los sigue contando`,
                  { undo: () => dispatch({ type: "restoreSpot", spot, before }) },
                );
                refocus("kept-travel");
              }}
            >
              Eliminar lugar
            </button>
          )}
          <button
            type="button"
            className="btn small"
            aria-label={`Olvidar ${short(spot.text)} y sus minutos`}
            onClick={() => {
              const before = Object.fromEntries(
                Object.entries(data.eventTravel ?? {}).filter(([, t]) => t.key === spot.key),
              );
              dispatch({ type: "forgetSpot", key: spot.key });
              toast.show(`${short(spot.text)} olvidada`, {
                undo: () => dispatch({ type: "restoreSpot", spot, before }),
              });
              refocus("spots");
            }}
          >
            Olvidar
          </button>
        </div>
      )}
      {keepable && !naming && (
        <p className="meta" style={{ width: "100%", margin: 0 }}>
          «Eliminar lugar» borra la dirección y deja los {spot.minutes} min en el evento. «Olvidar»
          borra las dos cosas.
        </p>
      )}
    </div>
  );
}
