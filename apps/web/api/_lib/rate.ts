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

/** Bound the memory: first whoever's day is over, then the least recently used. */
const MAX_USERS = 1000;
function evict(users: Map<string, Hits>, now: number) {
  for (const [k, v] of users) if (now - v.dayStart >= DAY) users.delete(k);
  for (const k of users.keys()) {
    if (users.size <= MAX_USERS) break;
    users.delete(k);
  }
}

export function limiter(perMinute: number, perDay: number) {
  const users = new Map<string, Hits>();
  return {
    /** Counts one request; false when the user is over either budget. */
    take(user: string, now = Date.now()): boolean {
      let h = users.get(user);
      if (!h || now - h.dayStart >= DAY) {
        h = { recent: [], day: 0, dayStart: now };
      }
      // Most recently used last, so the first key is always the one to forget.
      users.delete(user);
      users.set(user, h);
      if (users.size > MAX_USERS) evict(users, now);
      h.recent = h.recent.filter((t) => now - t < MINUTE);
      if (h.recent.length >= perMinute || h.day >= perDay) return false;
      h.recent.push(now);
      h.day++;
      return true;
    },
    /** Gives back the last request's slot (it cost nothing, e.g. no stops near). */
    refund(user: string) {
      const h = users.get(user);
      if (h && h.day > 0) {
        h.recent.pop();
        h.day--;
      }
    },
    reset() {
      users.clear();
    },
  };
}
