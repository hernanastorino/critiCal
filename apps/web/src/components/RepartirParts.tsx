import type { Dispatch } from "react";
import { useId, useRef, useState } from "react";
import { hours, parseHoursText } from "../format.js";
import {
  addRow,
  byWeight,
  type Fit,
  fillRest,
  freeName,
  hasWeights,
  markOf,
  nameProblem,
  overRow,
  proportional,
  type Row,
  removeRow,
  rowSpoken,
  type Sheet,
  STEP,
  slideMin,
  slideRow,
  slideTotal,
  spoken,
  TEMAS_MAX,
  typeTotal,
  unassigned,
} from "../repartir.js";
import { Marks } from "./icons.js";
import { useModal } from "./modal.js";

const MINUTE_CHOICES = [0, 15, 30, 45] as const;

/** Where a fraction of the track falls: the thumb's width is left at both ends (see `.rep-track`). */
const at = (frac: number) => `calc(var(--rep-thumb) / 2 + (100% - var(--rep-thumb)) * ${frac})`;

/**
 * Minutes of what is typed in the hours field: «3» (plus the chip's minutes), or «3,5», «3h15»,
 * «3:15» (with their own minutes: up to 5 over a multiple of 15 goes down, more goes up).
 * NaN when it is not hours.
 */
function typedMinutes(text: string, chip: number): number {
  const plain = text.normalize("NFKC");
  if (/^\s*\d{1,3}\s*$/.test(plain)) return Number(plain) * 60 + chip;
  const parsed = parseHoursText(text);
  if (!(parsed < 1000)) return Number.NaN;
  const total = Math.round(parsed * 60);
  const over = total % STEP;
  return over <= 5 ? total - over : total - over + STEP;
}

/** Hours and minutes (00, 15, 30, 45) picked to write a value instead of dragging. */
function TimePicker({
  title,
  value,
  floor,
  onPick,
  onClose,
}: {
  title: string;
  value: number;
  floor: number;
  onPick: Dispatch<number>;
  onClose: () => void;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const justOpened = useModal(sheet, onClose);
  const hoursId = useId();
  const errId = useId();
  const [h, setH] = useState(String(Math.floor(value / 60)));
  const [m, setM] = useState<number>(Math.floor((value % 60) / STEP) * STEP);
  const minutes = typedMinutes(h, m);
  const typed = Number.isNaN(minutes) ? Number.NaN : Math.floor(minutes / 60);
  const chip = Number.isNaN(minutes) ? m : minutes % 60;
  const bad = Number.isNaN(minutes) || minutes < floor;
  return (
    <>
      <button
        type="button"
        className="scrim dim top over"
        aria-hidden="true"
        tabIndex={-1}
        onClick={() => {
          if (!justOpened()) onClose();
        }}
      />
      <div
        ref={sheet}
        className="sheet rep-picker"
        role="dialog"
        aria-modal="true"
        aria-label={`Horas de ${title}`}
      >
        <button type="button" className="sheet-close" aria-label="Cerrar" onClick={onClose}>
          <Marks.close />
        </button>
        <h2>{title}</h2>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label className="field" style={{ flex: 1 }} htmlFor={hoursId}>
            <span>Horas</span>
            <input
              id={hoursId}
              inputMode="text"
              value={h}
              data-autofocus
              aria-invalid={bad ? true : undefined}
              aria-describedby={bad ? errId : undefined}
              onChange={(e) => {
                setH(e.target.value);
              }}
            />
          </label>
        </div>
        <div role="radiogroup" aria-label="Minutos" className="rep-mins">
          {MINUTE_CHOICES.map((c) => (
            // biome-ignore lint/a11y/useSemanticElements: a segmented choice, not a form radio
            <button
              type="button"
              key={c}
              role="radio"
              aria-checked={chip === c}
              className={`btn${chip === c ? " primary" : ""}`}
              onClick={() => {
                if (!Number.isNaN(typed)) setH(String(typed));
                setM(c);
              }}
            >
              {String(c).padStart(2, "0")}
            </button>
          ))}
        </div>
        {bad && (
          <p
            id={errId}
            className="meta"
            role="alert"
            style={{ color: "var(--critical-ink)", margin: "var(--space-1) 0" }}
          >
            {Number.isNaN(typed)
              ? "Poné horas y minutos válidos"
              : `No baja de lo hecho: ${hours(floor)}.`}
          </p>
        )}
        <button
          type="button"
          className="btn primary"
          disabled={bad}
          onClick={() => {
            onPick(minutes);
            onClose();
          }}
        >
          Guardar horas
        </button>
      </div>
    </>
  );
}

/** A slider with the value at its right (tap it to write it) and the minimum's mark over it. */
function TimeSlider({
  name,
  spokenText,
  value,
  scale,
  floor,
  mark,
  locked,
  red,
  onSlide,
  onOpen,
  extra,
}: {
  name: string;
  spokenText: string;
  value: number;
  scale: number;
  floor: number;
  mark: number;
  locked?: boolean;
  red?: boolean;
  onSlide: Dispatch<number>;
  onOpen: () => void;
  extra?: React.ReactNode;
}) {
  const max = Math.max(scale, value, STEP);
  return (
    <div className="rep-line">
      <div className="rep-track" style={{ ["--fill" as string]: `${(value / max) * 100}%` }}>
        {floor > 0 && (
          <span className="rep-floor" aria-hidden="true" style={{ width: at(floor / max) }} />
        )}
        <input
          type="range"
          min={0}
          max={max}
          step={STEP}
          value={value}
          disabled={locked}
          aria-label={name}
          aria-valuetext={spokenText}
          onChange={(e) => {
            onSlide(Number(e.target.value));
          }}
        />
        {mark > 0 && (
          <span className="rep-mark" aria-hidden="true" style={{ left: at(mark / max) }} />
        )}
        {extra}
      </div>
      <button
        type="button"
        className={`rep-time${red ? " red" : ""}`}
        aria-label={`Escribir las horas de ${name}`}
        disabled={locked}
        onClick={onOpen}
      >
        {hours(value)}
      </button>
    </div>
  );
}

/** The minimum's handle over the total: dragged (or moved with the arrows) in steps of 15. */
function MinHandle({
  sheet,
  max,
  onMove,
}: {
  sheet: Sheet;
  max: number;
  onMove: Dispatch<number>;
}) {
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const move = (clientX: number) => {
    const track = ref.current?.parentElement?.getBoundingClientRect();
    if (!track) return;
    const thumb = 28;
    const frac = (clientX - track.left - thumb / 2) / Math.max(1, track.width - thumb);
    onMove(Math.min(1, Math.max(0, frac)) * max);
  };
  const left = at(sheet.min / max);
  return (
    <>
      <button
        type="button"
        ref={ref}
        role="slider"
        className="rep-handle"
        style={{ left }}
        aria-label="Mínimo"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={sheet.total}
        aria-valuenow={sheet.min}
        aria-valuetext={spoken(sheet.min)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag(true);
        }}
        onPointerMove={(e) => {
          if (drag) move(e.clientX);
        }}
        onPointerUp={() => {
          setDrag(false);
        }}
        onPointerCancel={() => {
          setDrag(false);
        }}
        onKeyDown={(e) => {
          const by = e.key === "ArrowRight" || e.key === "ArrowUp" ? STEP : -STEP;
          if (e.key === "Home") onMove(0);
          else if (e.key === "End") onMove(sheet.total);
          else if (/^Arrow(Left|Right|Up|Down)$/.test(e.key)) onMove(sheet.min + by);
          else return;
          e.preventDefault();
        }}
      />
      {drag && (
        <span className="rep-tip" style={{ left }} aria-hidden="true">
          {hours(sheet.min)}
        </span>
      )}
    </>
  );
}

export type SetSheet = Dispatch<Sheet>;

/** The total's row: its slider with the minimum's handle over it. */
export function TotalRow({ s, setS, onOpen }: { s: Sheet; setS: SetSheet; onOpen: () => void }) {
  return (
    <div className="rep-row">
      <div className="rep-head">
        <b className="rep-name">Total</b>
        <span className="rep-min-label">Mínimo {hours(s.pick)}</span>
      </div>
      <TimeSlider
        name="Total"
        spokenText={`Total, ${spoken(s.total)}, mínimo ${spoken(s.min)}`}
        value={s.total}
        scale={s.totalScale}
        floor={s.totalFloor}
        mark={0}
        onSlide={(v) => {
          setS(slideTotal(s, v));
        }}
        onOpen={onOpen}
        extra={
          <MinHandle
            sheet={s}
            max={Math.max(s.totalScale, s.total, STEP)}
            onMove={(v) => {
              setS(slideMin(s, v));
            }}
          />
        }
      />
      <p className="rep-warn rep-lowered" aria-live="polite">
        {s.pick > s.min ? `El mínimo baja a ${hours(s.min)}` : ""}
      </p>
    </div>
  );
}

/** «No entra en el plan» / «No entra hasta la entrega» (it is accepted all the same). */
export function FitWarning({ fit }: { fit: Fit }) {
  if (!fit) return null;
  return (
    <p className="rep-warn" role="status">
      {fit === "plan" ? "No entra en el plan" : "No entra hasta la entrega"}
    </p>
  );
}

/** «Sin asignar» (red while the sum is not the total) and the presets. */
export function Rest({ s, setS }: { s: Sheet; setS: SetSheet }) {
  const rest = unassigned(s);
  return (
    <>
      <p className={`rep-rest${rest === 0 ? "" : " red"}`} role="status">
        Sin asignar <b>{rest < 0 ? `−${hours(-rest)}` : hours(rest)}</b>
      </p>
      <div className="rep-presets">
        <button
          type="button"
          className="btn small"
          onClick={() => {
            setS(proportional(s));
          }}
        >
          Proporcional
        </button>
        <button
          type="button"
          className="btn small"
          disabled={!hasWeights(s)}
          onClick={() => {
            setS(byWeight(s));
          }}
        >
          Por peso
        </button>
        <button
          type="button"
          className="btn small"
          disabled={rest === 0}
          onClick={() => {
            setS(fillRest(s));
          }}
        >
          Repartir el resto
        </button>
      </div>
    </>
  );
}

/** A tema: its name (typed when it is new), ✕ and its slider. */
function TemaRow({
  s,
  r,
  n,
  setS,
  onOpen,
}: {
  s: Sheet;
  r: Row;
  n: number;
  setS: SetSheet;
  onOpen: () => void;
}) {
  const problem = nameProblem(s, r);
  // A name left empty is still read as something.
  const label = r.title.trim() || `Tema ${n}`;
  const problemId = useId();
  const rename = (title: string) => {
    setS({ ...s, rows: s.rows.map((x) => (x.id === r.id ? { ...x, title } : x)) });
  };
  return (
    <li className="rep-row">
      <div className="rep-head">
        {r.added ? (
          <input
            className="rep-name"
            aria-label={`Nombre del tema ${n}`}
            value={r.title}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? problemId : undefined}
            onChange={(e) => {
              rename(e.target.value);
            }}
          />
        ) : (
          <span className="rep-name">{r.title}</span>
        )}
        {r.locked ? (
          <span className="meta">hecho</span>
        ) : (
          <button
            type="button"
            className="rep-x"
            aria-label={`Quitar ${label}`}
            onClick={() => {
              setS(removeRow(s, r.id));
            }}
          >
            <Marks.close />
          </button>
        )}
      </div>
      {problem && (
        <p
          id={problemId}
          className="meta"
          role="alert"
          style={{ color: "var(--critical-ink)", margin: "0 0 var(--space-1)" }}
        >
          {problem}
        </p>
      )}
      <TimeSlider
        name={r.locked ? `${label}, hecho` : label}
        spokenText={rowSpoken(s, { ...r, title: label })}
        value={r.minutes}
        scale={r.scale}
        floor={r.floor}
        mark={markOf(s, r)}
        locked={r.locked}
        red={overRow(s, r.id)}
        onSlide={(v) => {
          setS(slideRow(s, r.id, v));
        }}
        onOpen={onOpen}
      />
    </li>
  );
}

/** The temas and «+ Tema» at the end. */
export function TemaList({
  s,
  setS,
  onOpen,
}: {
  s: Sheet;
  setS: SetSheet;
  onOpen: Dispatch<string>;
}) {
  return (
    <ul className="rep-list">
      {s.rows.map((r, i) => (
        <TemaRow
          key={r.id}
          s={s}
          r={r}
          n={i + 1}
          setS={setS}
          onOpen={() => {
            onOpen(r.id);
          }}
        />
      ))}
      <li className="rep-add">
        <button
          type="button"
          className="btn small"
          disabled={s.rows.length >= TEMAS_MAX}
          onClick={() => {
            setS(addRow(s, freeName(s)));
          }}
        >
          + Tema
        </button>
      </li>
    </ul>
  );
}

/** The hour picker of the total or of the tema being written. */
export function Pickers({
  s,
  setS,
  typing,
  onClose,
}: {
  s: Sheet;
  setS: SetSheet;
  typing: string | null;
  onClose: () => void;
}) {
  const row = typing && typing !== "total" ? s.rows.find((r) => r.id === typing) : undefined;
  if (typing === "total") {
    return (
      <TimePicker
        title="Total"
        value={s.total}
        floor={s.totalFloor}
        onPick={(v) => {
          setS(typeTotal(s, v));
        }}
        onClose={onClose}
      />
    );
  }
  if (!row) return null;
  return (
    <TimePicker
      title={row.title}
      value={row.minutes}
      floor={row.floor}
      onPick={(v) => {
        setS(slideRow(s, row.id, v, true));
      }}
      onClose={onClose}
    />
  );
}
