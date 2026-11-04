// Web Push on this device: subscribe with the server's VAPID key, store the
// subscription in Supabase (RLS: only the owner sees it).
import type { SupabaseClient } from "@supabase/supabase-js";

const vapid = () => import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export type PushState = "unsupported" | "needs-install" | "denied" | "off" | "on";

/** iOS only offers push to the installed app (Add to Home Screen). */
export function isInstalled(): boolean {
  return (
    globalThis.matchMedia?.("(display-mode: standalone)").matches ||
    (globalThis.navigator as { standalone?: boolean } | undefined)?.standalone === true
  );
}

const isIos = () => /iPad|iPhone|iPod/.test(globalThis.navigator?.userAgent ?? "");

export async function pushState(): Promise<PushState> {
  if (!vapid() || !("serviceWorker" in navigator) || !("PushManager" in globalThis)) {
    return isIos() && !isInstalled() ? "needs-install" : "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ? "on" : "off";
}

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export async function enablePush(client: SupabaseClient): Promise<PushState> {
  const key = vapid();
  if (!key) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(key),
    }));
  const { endpoint, keys } = sub.toJSON();
  const { error } = await client
    .from("push_subscriptions")
    .upsert({ endpoint, keys }, { onConflict: "endpoint" });
  if (error) throw error;
  return "on";
}

export async function disablePush(client: SupabaseClient): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await client.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
  }
  return "off";
}
