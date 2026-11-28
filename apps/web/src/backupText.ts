// The texts of a backup file, cleaned the way the forms clean what is typed (#247): no
// characters that flip the writing direction, none that draw nothing, no control ones.
import { stripInvisible } from "./limits.js";

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => !!x && typeof x === "object" && !Array.isArray(x);

/** `x` with its text under `key` cleaned (anything that is not text stays for the checks to say). */
function cleanKey(x: unknown, key: string): unknown {
  if (!isRec(x)) return x;
  const v = x[key];
  return typeof v === "string" ? { ...x, [key]: stripInvisible(v) } : x;
}

/** Each record of a list with the given text keys cleaned. */
function cleanList(list: unknown, keys: string[]): unknown {
  if (!Array.isArray(list)) return list;
  return list.map((x) => keys.reduce<unknown>((acc, key) => cleanKey(acc, key), x));
}

/** A task's own title and those of its parts. */
function cleanTask(t: unknown): unknown {
  const task = cleanKey(t, "title");
  return isRec(task) && task.units !== undefined
    ? { ...task, units: cleanList(task.units, ["title"]) }
    : task;
}

/** A place with its name, address and every alias cleaned. */
function cleanPlace(p: unknown): unknown {
  const place = cleanList([p], ["name", "address"]);
  const one = Array.isArray(place) ? place.at(0) : p;
  if (!isRec(one) || !Array.isArray(one.aliases)) return one;
  return {
    ...one,
    aliases: one.aliases.map((a) => (typeof a === "string" ? stripInvisible(a) : a)),
  };
}

/** The data of a backup with every title, name, topic, place, alias and address cleaned. */
export function cleanBackupTexts(d: Rec): Rec {
  const out: Rec = { ...d };
  const set = (key: string, value: unknown) => {
    if (d[key] !== undefined) out[key] = value;
  };
  set("events", cleanList(d.events, ["title", "location"]));
  set("activities", cleanList(d.activities, ["name"]));
  set("calendars", cleanList(d.calendars, ["name"]));
  set("spots", cleanList(d.spots, ["text"]));
  set("tentativeSeen", cleanList(d.tentativeSeen, ["title"]));
  set("tasks", Array.isArray(d.tasks) ? d.tasks.map(cleanTask) : d.tasks);
  set("places", Array.isArray(d.places) ? d.places.map(cleanPlace) : d.places);
  return out;
}
