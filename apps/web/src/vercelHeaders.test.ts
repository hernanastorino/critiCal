import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface Config {
  headers: { source: string; headers: { key: string; value: string }[] }[];
  rewrites?: unknown;
}

describe("vercel.json: cabeceras de seguridad", () => {
  const config = JSON.parse(
    readFileSync(resolve(process.cwd(), "apps/web/vercel.json"), "utf8"),
  ) as Config;
  const all = config.headers.find((h) => h.source === "/(.*)")?.headers ?? [];
  const value = (key: string) => all.find((h) => h.key === key)?.value;

  it("pone las cuatro en todas las rutas", () => {
    expect(value("X-Content-Type-Options")).toBe("nosniff");
    expect(value("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(value("X-Frame-Options")).toBe("DENY");
    expect(value("Content-Security-Policy")).toBe("frame-ancestors 'none'");
  });

  it("no toca las rutas: sin rewrites que tapen api/*", () => {
    expect(config.rewrites).toBeUndefined();
  });
});
