// Development only: the local test account (supabase/seed.sql) and the invented providers.
// In a build `import.meta.env.DEV` is false, so none of this reaches staging or production.

/** True for a Supabase running on this machine. */
export function isLocalSupabase(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** The email and password form shows only in development against the local Supabase. */
export const localDev: boolean =
  import.meta.env.DEV && isLocalSupabase(import.meta.env.VITE_SUPABASE_URL as string | undefined);

/** `/api` answers with invented Google, iCloud, maps and Gemini data (apps/web/api/_lib/fake-providers.ts). */
export const fakeProviders: boolean = localDev && import.meta.env.VITE_FAKE_PROVIDERS === "1";

/** The refresh token the invented Google accepts; "Reconectar Google" stores it. */
export const FAKE_GOOGLE_REFRESH = "fake-google-refresh";
