// Development only: serves `/api/<name>` from the Vite dev server, the way Vercel serves
// the functions in production, so the app can be tried end to end against the local
// Supabase. With VITE_FAKE_PROVIDERS=1 (and only against a local Supabase) Google,
// iCloud, the maps and Gemini answer with invented data (fake-providers.ts).
import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { FAKE_GOOGLE_REFRESH, fakeFetch } from "./fake-providers.js";

export { FAKE_GOOGLE_REFRESH };

type Handler = (req: Request) => Promise<Response>;
type Load = (file: string) => Promise<Record<string, unknown>>;

/** True for a Supabase running on this machine. */
export function isLocalUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Turns on the invented providers when asked and safe: never against a hosted Supabase,
 * where invented tokens would end up in its Vault. Fills in the keys the functions
 * check for, so they do not answer "server_not_configured".
 */
export function enableFakeProviders(env: NodeJS.ProcessEnv): boolean {
  if (env.VITE_FAKE_PROVIDERS !== "1") return false;
  if (!isLocalUrl(env.SUPABASE_URL || env.VITE_SUPABASE_URL)) return false;
  env.GOOGLE_CLIENT_ID ||= "fake-client";
  env.GOOGLE_CLIENT_SECRET ||= "fake-secret";
  env.ORS_API_KEY ||= "fake-ors";
  env.GEMINI_API_KEY ||= "fake-gemini";
  globalThis.fetch = fakeFetch(globalThis.fetch);
  return true;
}

async function readAll(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/** Connect middleware for `/api`: loads the function's module and calls its method export. */
export function apiMiddleware(dir: string, load: Load) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = (req.url ?? "").split("?")[0] ?? "";
    const name = path.replace(/^\/api\//, "").replace(/^\//, "");
    // Only plain function names: no "_lib", no paths out of the folder.
    if (!/^[a-z][a-z-]*$/.test(name) || !existsSync(join(dir, `${name}.ts`))) return next();
    try {
      const mod = await load(join(dir, `${name}.ts`));
      const fn = mod[req.method ?? "GET"] as Handler | undefined;
      if (typeof fn !== "function") {
        res.statusCode = 405;
        res.end();
        return;
      }
      const body = ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : await readAll(req);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") headers.set(k, v);
      }
      const out = await fn(
        new Request(`http://${req.headers.host ?? "localhost"}${req.url}`, {
          method: req.method,
          headers,
          body: body?.length ? new Uint8Array(body) : undefined,
        }),
      );
      res.statusCode = out.status;
      out.headers.forEach((v, k) => {
        res.setHeader(k, v);
      });
      res.end(Buffer.from(await out.arrayBuffer()));
    } catch (e) {
      console.error(e);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: "dev_api_failed" }));
    }
  };
}
