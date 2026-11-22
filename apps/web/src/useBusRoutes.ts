import { useEffect, useState } from "react";
import { type BusRoute, loadRoutes, onRoutesChanged } from "./busRoutes.js";
import { useSync } from "./Connected.js";

/** The user's saved regular routes, read again whenever one is saved or deleted. */
export function useBusRoutes(): BusRoute[] {
  const client = useSync()?.client;
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
