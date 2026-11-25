import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface Config {
  headers: { source: string; headers: { key: string; value: string }[] }[];
  rewrites?: unknown;
  functions?: Record<string, { maxDuration?: number }>;
}

describe("vercel.json: funciones largas", () => {
  const config = JSON.parse(
    readFileSync(resolve(process.cwd(), "apps/web/vercel.json"), "utf8"),
  ) as Config;

  it("fija 60 s en las que llaman a Gemini o a rutas (rutas relativas a apps/web)", () => {
    for (const file of ["syllabus", "travel", "transit"]) {
      expect(config.functions?.[`api/${file}.ts`]?.maxDuration).toBe(60);
    }
  });
});

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
  });

  it("la CSP completa bloquea (no solo reporta), con destino de reportes y sin romper nada conocido", () => {
    expect(value("Content-Security-Policy-Report-Only")).toBeUndefined();
    const csp = value("Content-Security-Policy") ?? "";
    const dir = (name: string) =>
      csp
        .split(";")
        .map((d) => d.trim())
        .find((d) => d.startsWith(`${name} `));
    for (const name of [
      "default-src",
      "script-src",
      "style-src",
      "img-src",
      "connect-src",
      "font-src",
      "worker-src",
      "manifest-src",
      "frame-src",
      "form-action",
      "frame-ancestors",
      "object-src",
      "base-uri",
    ]) {
      expect(dir(name), name).toBeDefined();
    }
    expect(dir("default-src")).toBe("default-src 'self'");
    expect(dir("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(dir("object-src")).toBe("object-src 'none'");
    expect(dir("base-uri")).toBe("base-uri 'self'");
    // Scripts sin 'unsafe-inline' ni 'unsafe-eval'; los estilos inline son los style= de React.
    expect(dir("script-src")).toBe("script-src 'self'");
    expect(dir("style-src")).toContain("'unsafe-inline'");
    expect(dir("connect-src")).toContain("https://*.supabase.co wss://*.supabase.co");
    expect(dir("connect-src")).toContain("https://*.ingest.sentry.io");
    expect(dir("connect-src")).toContain("https://*.betterstackdata.com");
    expect(dir("img-src")).toContain("data:");
    expect(dir("img-src")).toContain("blob:");
    expect(csp).toContain("report-uri /api/csp-report");
    expect(csp).toContain("report-to csp-endpoint");
    expect(value("Reporting-Endpoints")).toBe('csp-endpoint="/api/csp-report"');
  });

  it("Permissions-Policy cierra lo que la app no usa", () => {
    const policy = value("Permissions-Policy") ?? "";
    for (const feature of ["camera", "microphone", "geolocation", "payment", "usb"]) {
      expect(policy).toContain(`${feature}=()`);
    }
  });

  it("no toca las rutas: sin rewrites que tapen api/*", () => {
    expect(config.rewrites).toBeUndefined();
  });
});
