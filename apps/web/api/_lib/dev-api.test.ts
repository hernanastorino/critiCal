import { mkdtempSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiMiddleware, enableFakeProviders, isLocalUrl } from "./dev-api.js";

afterEach(() => vi.unstubAllGlobals());

describe("isLocalUrl", () => {
  it("only accepts this machine", () => {
    expect(isLocalUrl("http://127.0.0.1:55321")).toBe(true);
    expect(isLocalUrl("http://localhost:55321")).toBe(true);
    expect(isLocalUrl("https://abc.supabase.co")).toBe(false);
    expect(isLocalUrl("not a url")).toBe(false);
    expect(isLocalUrl(undefined)).toBe(false);
  });
});

describe("enableFakeProviders", () => {
  it("needs the flag and a local Supabase", () => {
    vi.stubGlobal("fetch", vi.fn());
    const before = globalThis.fetch;
    expect(enableFakeProviders({ VITE_SUPABASE_URL: "http://127.0.0.1:1" })).toBe(false);
    expect(
      enableFakeProviders({ VITE_FAKE_PROVIDERS: "1", VITE_SUPABASE_URL: "https://x.supabase.co" }),
    ).toBe(false);
    expect(globalThis.fetch).toBe(before);
  });

  it("fills in the keys the functions check and swaps fetch", () => {
    vi.stubGlobal("fetch", vi.fn());
    const before = globalThis.fetch;
    const env: NodeJS.ProcessEnv = {
      VITE_FAKE_PROVIDERS: "1",
      SUPABASE_URL: "http://127.0.0.1:55321",
      ORS_API_KEY: "mine",
    };
    expect(enableFakeProviders(env)).toBe(true);
    expect(env).toMatchObject({ GOOGLE_CLIENT_ID: "fake-client", ORS_API_KEY: "mine" });
    expect(env.GEMINI_API_KEY).toBe("fake-gemini");
    expect(globalThis.fetch).not.toBe(before);
  });
});

function request(method: string, url: string, body?: string): IncomingMessage {
  const req = Readable.from(body ? [Buffer.from(body)] : []) as unknown as IncomingMessage;
  Object.assign(req, { method, url, headers: { host: "localhost:5174", "x-test": "1" } });
  return req;
}

function response() {
  const out = { status: 0, headers: {} as Record<string, string>, body: "" };
  const res = {
    set statusCode(s: number) {
      out.status = s;
    },
    setHeader: (k: string, v: string) => {
      out.headers[k] = v;
    },
    end: (b?: Buffer | string) => {
      out.body = b ? b.toString() : "";
    },
  } as unknown as ServerResponse;
  return { res, out };
}

describe("apiMiddleware", () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-api-"));
  writeFileSync(join(dir, "echo.ts"), "");

  const echo = async (req: Request) =>
    Response.json({ body: await req.text(), header: req.headers.get("x-test"), url: req.url });

  it("calls the function's method export with a Request", async () => {
    const load = vi.fn(async () => ({ ["POST"]: echo }));
    const { res, out } = response();
    await apiMiddleware(dir, load)(request("POST", "/echo?x=1", "hola"), res, () => undefined);
    expect(load).toHaveBeenCalledWith(join(dir, "echo.ts"));
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toEqual({
      body: "hola",
      header: "1",
      url: "http://localhost:5174/echo?x=1",
    });
    expect(out.headers["content-type"]).toMatch(/json/);
  });

  it("answers 405 for a method the function lacks", async () => {
    const { res, out } = response();
    await apiMiddleware(dir, async () => ({}))(request("GET", "/echo"), res, () => undefined);
    expect(out.status).toBe(405);
  });

  it("passes on unknown names, _lib and paths out of the folder", async () => {
    const load = vi.fn();
    for (const url of ["/nope", "/_lib/server", "/../secrets", "/Echo"]) {
      const next = vi.fn();
      await apiMiddleware(dir, load)(request("GET", url), response().res, next);
      expect(next).toHaveBeenCalledOnce();
    }
    expect(load).not.toHaveBeenCalled();
  });

  it("turns a crash into a 500 without details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { res, out } = response();
    await apiMiddleware(dir, async () => {
      throw new Error("secret detail");
    })(request("POST", "/echo"), res, () => undefined);
    expect(out.status).toBe(500);
    expect(out.body).not.toContain("secret");
  });
});
