import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";

/**
 * Roy, the character (SPEC §18.1): a Jacob's ladder of six painted boards joined by ribbons,
 * drawn in 3D with CSS (style A, «Madera pintada»). Each `anim` is a shape made with the
 * same boards. Poses and the cascade come from docs/mockups/estilo-toon.html.
 */
export type RoyAnim =
  | "cascada"
  | "vayvuelve"
  | "acordeon"
  | "oruga"
  | "festejo"
  | "hombros"
  | "desarmado"
  | "puente"
  | "reposo";

interface Pose {
  x: number;
  y: number;
  r: number;
  f?: number;
}
type Step = [pose: Pose[], ms: number, hold: number, stagger: number];

const N = 6;
const P = 61;
const V: Pose[] = [...Array(N)].map((_, i) => ({ x: 0, y: (i - 2.5) * P, r: 0 }));
/** The six boards lying side by side, `dy` px from the middle. */
const flat = (dy = 52): Pose[] =>
  [...Array(N)].map((_, i) => ({ x: (i - 2.5) * 60, y: dy, r: 90 }));
/** The ladder lying on its side, for a line of text: a row of boards that flip in turn. */
const H: Pose[] = [...Array(N)].map((_, i) => ({ x: (i - 2.5) * 58, y: 0, r: 0 }));
const F1: Pose[] = [
  { x: 0, y: -74, r: 0 },
  { x: -42, y: -60, r: -42 },
  { x: 42, y: -60, r: 42 },
  { x: 0, y: -6, r: 0 },
  { x: -18, y: 58, r: 10 },
  { x: 18, y: 58, r: -10 },
];
const F2: Pose[] = [
  { x: 0, y: -92, r: 0 },
  { x: -34, y: -90, r: -18, f: 360 },
  { x: 34, y: -90, r: 18, f: 360 },
  { x: 0, y: -22, r: 0 },
  { x: -26, y: 40, r: 26 },
  { x: 26, y: 40, r: -26 },
];
const S1: Pose[] = [
  { x: 0, y: -70, r: 0 },
  { x: -34, y: -6, r: 32 },
  { x: 34, y: -6, r: -32 },
  { x: 0, y: -4, r: 0 },
  { x: -12, y: 58, r: 0 },
  { x: 12, y: 58, r: 0 },
];
const S2: Pose[] = [
  { x: 0, y: -60, r: -9 },
  { x: -44, y: -30, r: 72 },
  { x: 44, y: -30, r: -72 },
  { x: 0, y: -4, r: 0 },
  { x: -12, y: 58, r: 0 },
  { x: 12, y: 58, r: 0 },
];
const Z: Pose[] = [...Array(N)].map((_, i) => ({
  x: i % 2 ? 7 : -7,
  y: (i - 2.5) * 13,
  r: i % 2 ? 78 : -78,
}));
const HEAP: Pose[] = [
  { x: 2, y: 6, r: 18 },
  { x: -28, y: 42, r: 96 },
  { x: 28, y: 42, r: 84 },
  { x: -58, y: 82, r: 90 },
  { x: 0, y: 84, r: 92 },
  { x: 58, y: 82, r: 88 },
];
const HEAP2 = HEAP.map((b, i) => (i === 0 ? { x: -4, y: 8, r: -16 } : b));
const BR: Pose[] = [
  { x: -92, y: 30, r: 0 },
  { x: -60, y: -8, r: 90 },
  { x: 0, y: -8, r: 90 },
  { x: 60, y: -8, r: 90 },
  { x: 92, y: 30, r: 0 },
  { x: 112, y: 38, r: -12 },
];
const BR2 = BR.map((b, i) =>
  i === 2
    ? { ...b, y: 6 }
    : i === 1
      ? { ...b, y: -2, r: 98 }
      : i === 3
        ? { ...b, y: -2, r: 82 }
        : b,
);
const REST = flat(46);
const REST2 = REST.map((b, i) => (i === 5 ? { x: b.x - 4, y: 30, r: 62 } : b));
/** Lying flat with board `k` lifted: the caterpillar's step. */
const wave = (k: number): Pose[] =>
  flat(46).map((b, i) =>
    i === k ? { ...b, y: 18 } : Math.abs(i - k) === 1 ? { ...b, y: 32, r: i < k ? 66 : 114 } : b,
  );

interface Def {
  /** The cascade: the top board turns and the knock goes down (and back, with `bounce`). */
  cascade?: { bounce: boolean };
  seq?: Step[];
  /** The shape shown still: with reduced motion, and where `once` stops. */
  still: Pose[];
}

export const ROY: Record<RoyAnim, Def> = {
  cascada: { cascade: { bounce: false }, still: V },
  vayvuelve: { cascade: { bounce: true }, still: V },
  acordeon: {
    seq: [
      [V, 500, 350, 40],
      [Z, 650, 500, 60],
    ],
    still: Z,
  },
  oruga: {
    seq: [...Array(N)].map((_, k): Step => [wave(k), 230, 0, 0]).concat([[flat(46), 260, 300, 0]]),
    still: wave(2),
  },
  festejo: {
    seq: [
      [V, 500, 250, 0],
      [F1, 600, 220, 30],
      [F2, 380, 120, 0],
      [F1, 360, 120, 0],
      [F2, 380, 120, 0],
      [F1, 360, 900, 0],
    ],
    still: F1,
  },
  hombros: {
    seq: [
      [S1, 500, 600, 0],
      [S2, 340, 700, 0],
      [S1, 340, 900, 0],
    ],
    still: S2,
  },
  desarmado: {
    seq: [
      [V, 500, 500, 0],
      [HEAP, 520, 300, 70],
      [HEAP2, 300, 300, 0],
      [HEAP, 300, 1200, 0],
    ],
    still: HEAP,
  },
  puente: {
    seq: [
      [BR, 500, 300, 0],
      [BR2, 420, 250, 0],
      [BR, 380, 250, 0],
      [BR2, 420, 250, 0],
      [BR, 380, 900, 0],
    ],
    still: BR2,
  },
  reposo: {
    seq: [
      [REST, 700, 1400, 0],
      [REST2, 500, 500, 0],
      [REST, 380, 900, 0],
    ],
    still: REST,
  },
};

/** A board, in the model's px (styles.css, `.roy-blk`). */
const BOARD = { w: 44, h: 58 };
/** Room left around the shape for its depth and its bounce. */
const FILL = 0.84;
/** Distance of the eye, in the model's px. */
const EYE = 1800;

/** The box every pose of a shape fits in: its centre and size, in the model's px. */
export function bounds(poses: Pose[][]) {
  let x0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const b of poses.flat()) {
    const a = (b.r * Math.PI) / 180;
    const hw = (Math.abs(Math.cos(a)) * BOARD.w + Math.abs(Math.sin(a)) * BOARD.h) / 2;
    const hh = (Math.abs(Math.sin(a)) * BOARD.w + Math.abs(Math.cos(a)) * BOARD.h) / 2;
    x0 = Math.min(x0, b.x - hw);
    x1 = Math.max(x1, b.x + hw);
    y0 = Math.min(y0, b.y - hh);
    y1 = Math.max(y1, b.y + hh);
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

/**
 * How big a shape is drawn: as large as fits in `size` px of height and `maxWidth` of
 * width, whatever its proportions (a standing ladder is tall, a bridge is wide), and
 * the box that takes. Before, every shape was scaled as if it were the tall ladder, so
 * the wide ones came out tiny.
 */
export function fit(poses: Pose[][], size: number, maxWidth: number, fixedScale?: number) {
  const b = bounds(poses);
  const scale = fixedScale ?? Math.min(size / b.h, maxWidth / b.w) * FILL;
  return {
    scale,
    cx: b.cx,
    cy: b.cy,
    width: Math.ceil((b.w * scale) / FILL),
    height: Math.ceil((b.h * scale) / FILL),
  };
}

const EASE = "cubic-bezier(.55,0,.25,1.3)";
const PERIOD = 2400;
const STEP = 110;
const FLIP = 0.13;

/** The CSS transform that puts a board in a pose. */
const transform = (b: Pose) =>
  `translate3d(${b.x}px,${b.y}px,0) rotateZ(${b.r}deg) rotateX(${b.f ?? 0}deg)`;

/** «Reducir movimiento» as the system has it now, and when the user changes it. */
function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(
    () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  useEffect(() => {
    const q = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!q?.addEventListener) return;
    const on = () => setReduce(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return reduce;
}

/** The six faces of a board: front, back, right, left, top, bottom. */
const FACES = ["fr", "bk", "rt", "lf", "tp", "bt"] as const;

/** Every pose of a shape, the way `Roy` measures it. */
function posesOf(anim: RoyAnim, ladder: Pose[]): Pose[][] {
  const def = ROY[anim];
  return def.cascade ? [ladder] : [def.still, ...(def.seq ?? []).map((s) => s[0])];
}

/**
 * One scale for every shape: the one at which the most demanding of them still fits in
 * `size` x `maxWidth`. Cards that sit side by side (the options of the inbox) use it so
 * Roy has the same size in all of them, whatever the proportions of his shape.
 */
export function uniformBox(size: number, maxWidth: number) {
  const anims = Object.keys(ROY) as RoyAnim[];
  const scale = Math.min(
    ...anims.map((a) => fit(posesOf(a, V), size, maxWidth).scale),
    ...anims.map((a) => fit(posesOf(a, H), size, maxWidth).scale),
  );
  const boxes = anims.map((a) => fit(posesOf(a, V), size, maxWidth, scale));
  return {
    scale,
    width: Math.max(...boxes.map((b) => b.width)),
    height: Math.max(...boxes.map((b) => b.height)),
  };
}

/** Draws Roy in the shape `anim`: looping, or once and still with `once` (SPEC §18.1). */
export function Roy({
  anim,
  size = 120,
  maxWidth = size * 1.4,
  once = false,
  flat: lying = false,
  scale: fixedScale,
}: {
  anim: RoyAnim;
  /** Most height in px he may take; the box is as tall as the shape needs. */
  size?: number;
  /** Most width in px he may take. */
  maxWidth?: number;
  /** The ladder on its side (next to a line of text); only the cascades have it. */
  flat?: boolean;
  /** Plays the shape once and stays still (a notice at the bottom), instead of in a loop. */
  once?: boolean;
  /** Draws him at exactly this scale (see `uniformBox`), ignoring `size` and `maxWidth`. */
  scale?: number;
}) {
  const reduce = useReducedMotion();
  const stage = useRef<HTMLDivElement>(null);
  const def = ROY[anim];
  const ladder = lying ? H : V;

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const blks = [...el.querySelectorAll<HTMLElement>(".roy-blk")];
    const set = (pose: Pose[], ms: number, stagger: number) => {
      blks.forEach((b, i) => {
        b.style.transitionDuration = `${ms}ms`;
        b.style.transitionDelay = `${stagger * i}ms`;
        b.style.transform = transform(pose[i] as Pose);
      });
    };
    const anims: Animation[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (def.cascade) {
      set(ladder, 0, 0);
      const bounce = def.cascade.bounce;
      if (!reduce && !once) {
        blks.forEach((b, i) => {
          const flip = b.firstElementChild;
          if (typeof (flip as HTMLElement | null)?.animate !== "function") return;
          const a1 = (i * STEP) / PERIOD;
          const b1 = 0.5 + ((bounce ? N - 1 - i : i) * STEP) / PERIOD;
          anims.push(
            (flip as HTMLElement).animate(
              [
                { offset: 0, transform: "rotateX(0deg)" },
                { offset: a1, transform: "rotateX(0deg)", easing: EASE },
                { offset: a1 + FLIP, transform: "rotateX(-180deg)" },
                { offset: b1, transform: "rotateX(-180deg)", easing: EASE },
                { offset: b1 + FLIP, transform: "rotateX(-360deg)" },
                { offset: 1, transform: "rotateX(-360deg)" },
              ],
              { duration: PERIOD, iterations: Number.POSITIVE_INFINITY },
            ),
          );
        });
      }
    } else if (def.seq) {
      const seq = def.seq;
      if (reduce) {
        set(def.still, 0, 0);
      } else {
        set((seq[0] as Step)[0], 0, 0);
        let k = 0;
        const next = () => {
          k += 1;
          if (k >= seq.length) {
            if (once) return;
            k = 0;
          }
          const [pose, ms, hold, stagger] = seq[k] as Step;
          set(pose, ms, stagger);
          timer = setTimeout(next, ms + stagger * N + hold);
        };
        // The first shape is the one at rest: after its hold the movement starts.
        timer = setTimeout(next, (seq[0] as Step)[2] + 200);
      }
    }
    return () => {
      clearTimeout(timer);
      for (const a of anims) a.cancel();
    };
  }, [def, reduce, once, ladder]);

  const box = fit(posesOf(anim, ladder), size, maxWidth, fixedScale);
  const style = {
    "--roy-s": box.scale,
    "--roy-x": `${-box.cx}px`,
    "--roy-y": `${-box.cy}px`,
    "--roy-d": `${EYE * box.scale}px`,
    height: box.height,
    width: box.width,
  };
  return (
    <div className="roy" data-anim={anim} aria-hidden="true" style={style as CSSProperties}>
      <div className="roy-stage" ref={stage}>
        {[...Array(N)].map((_, i) => (
          // Six boards that never reorder.
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed list
          <div className="roy-blk" key={i}>
            <div className="roy-flip">
              {FACES.map((f) => (
                <i key={f} className={`roy-f roy-${f}`} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A line of text with Roy at its left, in the shape of what the text says. */
export function RoyLine({
  anim,
  children,
  size = 84,
  big,
  uniform,
}: {
  anim: RoyAnim;
  children: ReactNode;
  size?: number;
  /** Twice as big, above the text instead of taking its width. */
  big?: boolean;
  /** Same size in every card that uses it: a fixed slot, and one scale for all shapes. */
  uniform?: boolean;
}) {
  if (uniform) {
    const box = uniformBox(size, 112);
    return (
      <div className="roy-line">
        <div className="roy-slot" style={{ width: box.width, height: box.height }}>
          <Roy anim={anim} scale={box.scale} />
        </div>
        <p className="meta">{children}</p>
      </div>
    );
  }
  return (
    <div className={`roy-line${big ? " big" : ""}`}>
      <Roy anim={anim} size={big ? size * 2 : size} maxWidth={big ? 224 : 112} />
      <p className="meta">{children}</p>
    </div>
  );
}
