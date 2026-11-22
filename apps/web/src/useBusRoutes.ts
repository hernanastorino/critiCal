import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { type BusRoute, loadRoutes, onRoutesChanged } from "./busRoutes.js";

/** The user's saved regular routes, read again whenever one is saved or deleted. */
export function useBusRoutes(client: SupabaseClient | undefined): BusRoute[] {
  const [routes, setRoutes] = useState<BusRoute[]>([]);
  useEffect(() => {
    if (!client) return;
    let live = true;
    const read = () => {
      void loadRoutes(client).then((r) => {
        if (live) setRoutes(r);
      });
    };
    read();
    const off = onRoutesChanged(read);
    return () => {
      live = false;
      off();
    };
  }, [client]);
  return client ? routes : [];
}
