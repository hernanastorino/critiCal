import { useDeferredValue, useId, useMemo, useRef, useState } from "react";
import { clipName, hours } from "../format.js";
import type { AppTask } from "../model.js";
import { doneMinutes } from "../planning.js";
import {
  addRow,
  applySheet,
  byWeight,
  canAccept,
  fillRest,
  fitOf,
  hasWeights,
  markOf,
  openSheet,
  overRow,
  type Prefill,
  proportional,
  type Row,
  removeRow,
  type Sheet,
  STEP,
  slideMin,
  slideRow,
  slideTotal,
  spoken,
  trialOf,
  typeTotal,
  unassigned,
} from "../repartir.js";
import { useStore } from "../store.js";
import { ConfirmDiscard } from "./ConfirmDiscard.js";
import { Marks } from "./icons.js";
import { useModal } from "./modal.js";
import { PLAN_KEYS, useUndoable } from "./useUndoable.js";

const MINUTE_CHOICES = [0, 15, 30, 45] as const;

/** Where a fraction of the track falls: the thumb's width is left at both ends (see `.rep-track`). */
const at = (frac: number) => `calc(var(--rep-thumb) / 2 + (100% - var(--rep-thumb)) * ${frac})`;

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
  onPick: (minutes: number) => void;
  onClose: () => void;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const justOpened = useModal(sheet, onClose);
  const hoursId = useId();
  const [h, setH] = useState(String(Math.floor(value / 60)));
  const [m, setM] = useState<number>(Math.floor((value % 60) / STEP) * STEP);
  const typed = /^\d{1,3}$/.test(h.trim()) ? Number(h) : Number.NaN;
  const minutes = typed * 60 + m;
  const bad = Number.isNaN(typed) || minutes < floor;
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
              inputMode="numeric"
              value={h}
              data-autofocus
              aria-invalid={bad ? true : undefined}
              onChange={(e) => setH(e.target.value)}
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
              aria-checked={m === c}
              className={`btn${m === c ? " primary" : ""}`}
              onClick={() => setM(c)}
            >
              {String(c).padStart(2, "0")}
            </button>
          ))}
        </div>
        {bad && Number.isFinite(typed) && (
          <p className="meta" role="status" style={{ color: "var(--critical-ink)" }}>
            No baja de lo hecho: {hours(floor)}.
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
  onSlide: (v: number) => void;
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
          onChange={(e) => onSlide(Number(e.target.value))}
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
  onMove: (v: number) => void;
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
          e.currentTarget.setPointerCapture?.(e.pointerId);
          setDrag(true);
        }}
        onPointerMove={(e) => {
          if (drag) move(e.clientX);
        }}
        onPointerUp={() => setDrag(false)}
        onPointerCancel={() => setDrag(false)}
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

/**
 * «Repartir tiempo» (SPEC §18 punto 18): the total of a task and a slider for each tema.
 * It only gives back what was decided (`onAccept`); the caller saves it.
 */
export function Repartir({
  task: given,
  initial,
  onAccept,
  onClose,
}: {
  task: AppTask;
  /** Where it starts when that is not the task as it is (what an option would leave). */
  initial?: Prefill;
  onAccept: (next: AppTask) => void;
  onClose: () => void;
}) {
  const { data, now } = useStore();
  // The task as it was when the sheet opened: the plan is not worked out again for a new object.
  const [task] = useState(given);
  const sheetEl = useRef<HTMLDivElement>(null);
  const done = useMemo(() => doneMinutes(data, task.id), [data, task.id]);
  const [start] = useState(() => openSheet(initial ?? task, done));
  const [s, setS] = useState<Sheet>(start);
  const [typing, setTyping] = useState<"total" | string | null>(null);
  const [asking, setAsking] = useState(false);
  const dirty = JSON.stringify(s) !== JSON.stringify(start);
  const askClose = () => (dirty ? setAsking(true) : onClose());
  const justOpened = useModal(sheetEl, askClose);
  // The plan is worked out for what the sliders stopped on, not for every step of a drag.
  const calm = useDeferredValue(s);
  const fit = useMemo(() => fitOf(data, now, trialOf(task, calm)), [data, now, task, calm]);
  const rest = unassigned(s);
  const hasRows = s.rows.length > 0;
  const total = s.total;
  const row = (id: string) => s.rows.find((r) => r.id === id);
  const typedRow = typing && typing !== "total" ? row(typing) : undefined;

  const renderRow = (r: Row) => (
    <li key={r.id} className="rep-row">
      <div className="rep-head">
        {r.added ? (
          <input
            className="rep-name"
            aria-label="Nombre del tema"
            value={r.title}
            onChange={(e) =>
              setS({
                ...s,
                rows: s.rows.map((x) => (x.id === r.id ? { ...x, title: e.target.value } : x)),
              })
            }
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
            aria-label={`Quitar ${r.title}`}
            onClick={() => setS(removeRow(s, r.id))}
          >
            <Marks.close />
          </button>
        )}
      </div>
      <TimeSlider
        name={r.title}
        spokenText={`${r.title}, ${spoken(r.minutes)}, mínimo ${spoken(Math.round(markOf(s, r)))}`}
        value={r.minutes}
        scale={r.scale}
        floor={r.floor}
        mark={markOf(s, r)}
        locked={r.locked}
        red={overRow(s, r.id)}
        onSlide={(v) => setS(slideRow(s, r.id, v))}
        onOpen={() => setTyping(r.id)}
      />
    </li>
  );

  return (
    <>
      {/* For taps; the keyboard and VoiceOver have ✕ and Escape. */}
      <button
        type="button"
        className="scrim dim top"
        aria-hidden="true"
        tabIndex={-1}
        onClick={() => {
          if (!justOpened()) askClose();
        }}
      />
      <div
        ref={sheetEl}
        className="sheet repartir"
        role="dialog"
        aria-modal="true"
        aria-label="Repartir tiempo"
      >
        <button type="button" className="sheet-close" aria-label="Cerrar" onClick={askClose}>
          <Marks.close />
        </button>
        <h2>Repartir tiempo</h2>
        <p className="meta rep-task">{clipName(task.title)}</p>
        <div className="rep-top">
          <div className="rep-row">
            <div className="rep-head">
              <b className="rep-name">Total</b>
            </div>
            <TimeSlider
              name="Total"
              spokenText={`Total, ${spoken(total)}, mínimo ${spoken(s.min)}`}
              value={total}
              scale={s.totalScale}
              floor={s.totalFloor}
              mark={0}
              onSlide={(v) => setS(slideTotal(s, v))}
              onOpen={() => setTyping("total")}
              extra={
                <MinHandle
                  sheet={s}
                  max={Math.max(s.totalScale, total, STEP)}
                  onMove={(v) => setS(slideMin(s, v))}
                />
              }
            />
          </div>
          {fit === "plan" && (
            <p className="rep-warn" role="status">
              No entra en el plan
            </p>
          )}
          {fit === "deadline" && (
            <p className="rep-warn" role="status">
              No entra hasta la entrega
            </p>
          )}
          {hasRows && (
            <p className={`rep-rest${rest === 0 ? "" : " red"}`} role="status">
              Sin asignar <b>{rest < 0 ? `−${hours(-rest)}` : hours(rest)}</b>
            </p>
          )}
          {hasRows && (
            <div className="rep-presets">
              <button type="button" className="btn small" onClick={() => setS(proportional(s))}>
                Proporcional
              </button>
              <button
                type="button"
                className="btn small"
                disabled={!hasWeights(s)}
                onClick={() => setS(byWeight(s))}
              >
                Por peso
              </button>
              <button
                type="button"
                className="btn small"
                disabled={rest === 0}
                onClick={() => setS(fillRest(s))}
              >
                Repartir el resto
              </button>
            </div>
          )}
        </div>
        {hasRows && (
          <ul className="rep-list">
            {s.rows.map(renderRow)}
            <li className="rep-add">
              <button
                type="button"
                className="btn small"
                onClick={() => setS(addRow(s, `Tema ${s.rows.length + 1}`))}
              >
                + Tema
              </button>
            </li>
          </ul>
        )}
        <button
          type="button"
          className="btn primary rep-accept"
          disabled={!canAccept(s)}
          onClick={() => onAccept(applySheet(task, s))}
        >
          Aceptar reparto
        </button>
      </div>
      {typing === "total" && (
        <TimePicker
          title="Total"
          value={total}
          floor={s.totalFloor}
          onPick={(v) => setS(typeTotal(s, v))}
          onClose={() => setTyping(null)}
        />
      )}
      {typedRow && (
        <TimePicker
          title={typedRow.title}
          value={typedRow.minutes}
          floor={typedRow.floor}
          onPick={(v) => setS(slideRow(s, typedRow.id, v, true))}
          onClose={() => setTyping(null)}
        />
      )}
      {asking && (
        <ConfirmDiscard
          onDiscard={() => {
            setAsking(false);
            onClose();
          }}
          onKeep={() => setAsking(false)}
        />
      )}
    </>
  );
}

/**
 * «Repartir tiempo» on a task of the app: «Aceptar» saves it in one step, which leaves one
 * entry in the ↶ («repartir X»), and says so with a notice that undoes it.
 */
export function RepartirTask({
  task,
  initial,
  message,
  onClose,
  onDone,
  onUndone,
}: {
  task: AppTask;
  initial?: Prefill;
  /** What the notice says (it always offers «Deshacer»). */
  message?: string;
  onClose: () => void;
  onDone?: () => void;
  /** Called when the notice's «Deshacer» took it back (where focus should go). */
  onUndone?: () => void;
}) {
  const answer = useUndoable(() => onUndone?.());
  return (
    <Repartir
      task={task}
      initial={initial}
      onClose={onClose}
      onAccept={(next) => {
        answer(
          message ?? `Repartiste ${clipName(task.title)}`,
          {
            type: "batch",
            label: `repartir ${clipName(task.title, 24)}`,
            actions: [{ type: "saveTask", task: next }],
          },
          [...PLAN_KEYS],
          { tasks: [task], key: "repartir", ...(message ? { roy: "festejo" as const } : {}) },
        );
        onDone?.();
        onClose();
      }}
    />
  );
}
