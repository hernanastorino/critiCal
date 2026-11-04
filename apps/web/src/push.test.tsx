import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Notifications } from "./components/Notifications.js";
import { demoData } from "./demo.js";
import * as push from "./push.js";
import { StoreProvider, useStore } from "./store.js";

function browser(subscribed: boolean, permission: NotificationPermission = "default") {
  const sub = {
    endpoint: "https://push/1",
    toJSON: () => ({ endpoint: "https://push/1", keys: { p256dh: "k", auth: "a" } }),
    unsubscribe: vi.fn(async () => true),
  };
  let current = subscribed ? sub : null;
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async () => {
      current = sub;
      return sub;
    }),
  };
  const reg = { pushManager };
  vi.stubGlobal("navigator", {
    ...navigator,
    userAgent: "Mozilla/5.0 (iPhone)",
    serviceWorker: {
      getRegistration: async () => reg,
      ready: Promise.resolve(reg),
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", { permission, requestPermission: vi.fn(async () => "granted") });
  return { sub, pushManager };
}

function client() {
  const calls: { op: string; payload?: unknown }[] = [];
  return {
    calls,
    client: {
      from: () => ({
        upsert: async (payload: unknown, opts: unknown) => {
          calls.push({ op: "upsert", payload: [payload, opts] });
          return { error: null };
        },
        delete: () => ({
          eq: async (_c: string, v: unknown) => {
            calls.push({ op: "delete", payload: v });
            return { error: null };
          },
        }),
      }),
    } as never,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "BAAA"));

describe("push on this device", () => {
  it("subscribes with the server key and stores the subscription", async () => {
    const { pushManager } = browser(false);
    const db = client();
    expect(await push.pushState()).toBe("off");
    expect(await push.enablePush(db.client)).toBe("on");
    expect(pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    );
    expect(db.calls[0]).toEqual({
      op: "upsert",
      payload: [
        { endpoint: "https://push/1", keys: { p256dh: "k", auth: "a" } },
        { onConflict: "endpoint" },
      ],
    });
    expect(await push.pushState()).toBe("on");
  });

  it("unsubscribes and forgets the device", async () => {
    const { sub } = browser(true);
    const db = client();
    expect(await push.disablePush(db.client)).toBe("off");
    expect(sub.unsubscribe).toHaveBeenCalled();
    expect(db.calls).toEqual([{ op: "delete", payload: "https://push/1" }]);
  });

  it("explains why it cannot", async () => {
    browser(false, "denied");
    expect(await push.pushState()).toBe("denied");
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (iPhone)" });
    expect(await push.pushState()).toBe("needs-install");
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows)" });
    expect(await push.pushState()).toBe("unsupported");
  });
});

function Prefs() {
  const { data } = useStore();
  return (
    <output data-testid="prefs">{JSON.stringify(data.preferences?.notifications ?? {})}</output>
  );
}

describe("notification settings", () => {
  it("saves which notifications to send, even without an account", async () => {
    browser(false);
    render(
      <StoreProvider initial={demoData} persist={false}>
        <Notifications />
        <Prefs />
      </StoreProvider>,
    );
    expect(screen.getByText(/Entrá con Google/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Cuando un evento nuevo cambia el plan de hoy"));
    });
    fireEvent.change(screen.getByLabelText("Minutos antes"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Hora del recordatorio"), {
      target: { value: "20:30" },
    });
    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId("prefs").textContent ?? "{}")).toEqual({
        proposals: false,
        leadMinutes: 30,
        sundayAt: 20 * 60 + 30,
      }),
    );
  });
});
