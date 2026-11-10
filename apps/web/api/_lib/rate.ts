// A per-user request budget kept in memory. Each warm function instance counts for
// itself, which is enough to stop a script from draining the shared routing quota; the
// day total is therefore per instance too.

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

interface Hits {
  recent: number[];
  day: number;
  dayStart: number;
}

export function limiter(perMinute: number, perDay: number) {
  const users = new Map<string, Hits>();
  return {
    /** Counts one request; false when the user is over either budget. */
    take(user: string, now = Date.now()): boolean {
      // Bound the memory: forget everyone when the table grows (one person's app).
      if (users.size > 1000) users.clear();
      let h = users.get(user);
      if (!h || now - h.dayStart >= DAY) {
        h = { recent: [], day: 0, dayStart: now };
        users.set(user, h);
      }
      h.recent = h.recent.filter((t) => now - t < MINUTE);
      if (h.recent.length >= perMinute || h.day >= perDay) return false;
      h.recent.push(now);
      h.day++;
      return true;
    },
    reset() {
      users.clear();
    },
  };
}
