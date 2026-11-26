import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppData } from "./model.js";
import { reportError } from "./monitoring.js";
import { isOffline } from "./offline.js";
import { loadData, loadSince, OVERLAP_MS, serverNow, TOMBSTONES_MS } from "./remote.js";

/**
 * What the database holds now: only what changed since `since` when there is a trusted mark
 * for it (`at` is the server's clock for the next one), everything otherwise: no mark, a
 * mark older than the tombstones last, a server without the incremental functions yet, or
 * any answer that cannot be used. A network failure is not hidden: it throws.
 */
export async function loadFresh(
  client: SupabaseClient,
  base: AppData,
  since: number | null,
): Promise<{ data: AppData; at: number | null; whole: boolean }> {
  const at = await serverNow(client).catch((e: unknown) => {
    if (isOffline(e)) throw e;
    return null;
  });
  if (at !== null && since !== null && at - since < TOMBSTONES_MS - OVERLAP_MS) {
    try {
      return { data: await loadSince(client, base, since), at, whole: false };
    } catch (e) {
      if (isOffline(e)) throw e;
      reportError(e, { where: "incremental" });
    }
  }
  return { data: await loadData(client), at, whole: true };
}
