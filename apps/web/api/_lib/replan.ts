// Server-side sync for one user, without the app open: calendars in, re-plan, Plan out.
import { applyWrites, diffData, loadData } from "../../src/data.js";
import type { AppData, Proposal } from "../../src/model.js";
import { refresh } from "../../src/refresh.js";
import { syncICloudFor } from "../icloud-sync.js";
import { importGoogle, mirrorPlan, openGoogle, watchCalendars } from "./google-run.js";
import { actAs, type Caller, type Env } from "./server.js";

const sameConflicts = (a: Proposal, b: Proposal) =>
  JSON.stringify([...a.conflicts].sort()) === JSON.stringify([...b.conflicts].sort());

/** A proposal for today that the user has not been told about yet. */
export function newProposal(before: AppData, after: AppData): Proposal | undefined {
  return after.proposals.find(
    (p) => !before.proposals.some((q) => q.id === p.id || sameConflicts(p, q)),
  );
}

/** Re-plans from `now` exactly as the app would and stores the difference. */
export async function replan(caller: Caller, now: number) {
  const before = await loadData(caller.user);
  const after = refresh(before, now);
  await applyWrites(caller.user, diffData(before, after));
  return { data: after, proposal: newProposal(before, after) };
}

export interface ServerSync {
  google?: boolean;
  icloud?: boolean;
  proposal?: Proposal;
  data: AppData;
  caller: Caller;
}

/** Everything the app does on open, for a user who is not looking. */
export async function serverSync(env: Env, uid: string, now = Date.now()): Promise<ServerSync> {
  const caller = await actAs(env, uid);
  const google = await openGoogle(caller, env).catch((e) => {
    console.warn("google token", e);
    return null;
  });
  let imported: Awaited<ReturnType<typeof importGoogle>> | undefined;
  if (google) {
    imported = await importGoogle(google, now);
    if (env.appUrl) await watchCalendars(google, imported.calendarIds, env.appUrl, now);
  }
  const icloud = (await (await syncICloudFor(caller)).json()) as { connected?: boolean };
  const { data, proposal } = await replan(caller, now);
  if (google) await mirrorPlan(google, now, imported?.planCalendar);
  return { google: !!google, icloud: !!icloud.connected, proposal, data, caller };
}
