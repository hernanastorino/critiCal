import { useEffect, useRef } from "react";
import { progress } from "../planning.js";
import { useStore } from "../store.js";
import { useToast } from "./Toast.js";

/** Titles of the deliveries that were open in `before` and are closed in `now`. */
export function justClosed(
  before: Map<string, number>,
  now: Map<string, { title: string; left: number }>,
) {
  const closed: string[] = [];
  for (const [id, { title, left }] of now) {
    if (left === 0 && (before.get(id) ?? 0) > 0) closed.push(title);
  }
  return closed;
}

/**
 * Roy celebrates when a silo reaches 100 % (SPEC §18.1): a delivery closed, whatever
 * screen did it. Habits start over every week, so they do not count. Nothing at start-up.
 */
export function Celebrations() {
  const { data } = useStore();
  const toast = useToast();
  const left = useRef<Map<string, number> | null>(null);
  useEffect(() => {
    const now = new Map<string, { title: string; left: number }>();
    for (const p of progress(data, Date.now())) {
      if (p.task.kind === "habit" || p.totalMinutes <= 0) continue;
      now.set(p.task.id, { title: p.task.title, left: p.remainingMinutes });
    }
    const before = left.current;
    left.current = new Map([...now].map(([id, v]) => [id, v.left]));
    if (!before) return;
    const [first] = justClosed(before, now);
    if (first) toast.show(`${first}: entrega cerrada. Bien ahí.`, { roy: "festejo" });
  }, [data, toast]);
  return null;
}
