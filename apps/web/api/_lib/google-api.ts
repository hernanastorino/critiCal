// Google Calendar REST helpers for the sync functions.
import type { CalendarListItem, GoogleEvent } from "./google.js";
import type { Env } from "./server.js";

const GOOGLE = "https://www.googleapis.com/calendar/v3";

/** A failure the client may see: a stable code and the upstream HTTP status, no internals. */
export class SyncError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number,
    readonly reason?: string,
  ) {
    super(code);
  }
}

export async function accessToken(env: Env, refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.googleClientId ?? "",
      client_secret: env.googleClientSecret ?? "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    // Google's OAuth error code ("invalid_client", "invalid_grant") is safe to show.
    const reason = await res
      .json()
      .then((b) => (typeof b?.error === "string" ? b.error : undefined))
      .catch(() => undefined);
    throw new SyncError("token_refresh_failed", res.status, reason);
  }
  return (await res.json()).access_token as string;
}

export async function google<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${GOOGLE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!res.ok && res.status !== 410) throw new SyncError("google_api_error", res.status);
  return (res.status === 204 || res.status === 410 ? {} : await res.json()) as T;
}

export async function listEvents(
  token: string,
  calendarId: string,
  from: Date,
  to: Date,
): Promise<GoogleEvent[]> {
  const out: GoogleEvent[] = [];
  let pageToken: string | undefined;
  do {
    const q = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: "true",
      maxResults: "250",
      ...(pageToken ? { pageToken } : {}),
    });
    const page = await google<{ items: GoogleEvent[]; nextPageToken?: string }>(
      token,
      `/calendars/${encodeURIComponent(calendarId)}/events?${q}`,
    );
    out.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

/** Every calendar in the user's list; pruning must never see a partial list. */
export async function listCalendars(token: string): Promise<CalendarListItem[]> {
  const out: CalendarListItem[] = [];
  let pageToken: string | undefined;
  do {
    const q = new URLSearchParams({ maxResults: "250", ...(pageToken ? { pageToken } : {}) });
    const page = await google<{ items?: CalendarListItem[]; nextPageToken?: string }>(
      token,
      `/users/me/calendarList?${q}`,
    );
    out.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

export interface Channel {
  id: string;
  resourceId: string;
  expiration: number;
}

/** Push notifications for one calendar's events, delivered to `address` for up to a week. */
export async function watchEvents(
  token: string,
  calendarId: string,
  address: string,
  id: string,
  secret: string,
): Promise<Channel> {
  const res = await google<{ id: string; resourceId: string; expiration: string }>(
    token,
    `/calendars/${encodeURIComponent(calendarId)}/events/watch`,
    { method: "POST", body: JSON.stringify({ id, type: "web_hook", address, token: secret }) },
  );
  return { id: res.id, resourceId: res.resourceId, expiration: Number(res.expiration) };
}

export async function stopChannel(token: string, id: string, resourceId: string): Promise<void> {
  // A channel that already expired answers 404: nothing left to stop.
  await fetch(`${GOOGLE}/channels/stop`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id, resourceId }),
  });
}
