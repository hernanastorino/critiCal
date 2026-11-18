import { afterEach, describe, expect, it, vi } from "vitest";
import { byIp, handle, MAX_BODY, securityUrl } from "./csp-report.js";

const dsn = "https://abc@o1.ingest.sentry.io/42";
const req = (body: string, type = "application/csp-report") =>
  new Request("https://x.test/api/csp-report", {
    method: "POST",
    headers: { "content-type": type },
    body,
  });

describe("csp-report", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("arma la URL de seguridad de Sentry desde el DSN", () => {
    expect(securityUrl(dsn)).toBe("https://o1.ingest.sentry.io/api/42/security/?sentry_key=abc");
    expect(securityUrl("nada")).toBeNull();
  });

  it("reenvía el reporte a Sentry y responde 204", async () => {
    const fetched = vi.fn(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", fetched);
    const res = await handle(req('{"csp-report":{}}'), { sentryDsn: dsn });
    expect(res.status).toBe(204);
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it("limita por IP: pasado el cupo responde 429 y no reenvía", async () => {
    const fetched = vi.fn(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", fetched);
    byIp.reset();
    const from = (ip: string) =>
      new Request("https://x.test/api/csp-report", {
        method: "POST",
        headers: { "content-type": "application/csp-report", "x-forwarded-for": ip },
        body: "{}",
      });
    for (let i = 0; i < 20; i++)
      expect((await handle(from("1.1.1.1"), { sentryDsn: dsn })).status).toBe(204);
    expect((await handle(from("1.1.1.1"), { sentryDsn: dsn })).status).toBe(429);
    expect((await handle(from("2.2.2.2"), { sentryDsn: dsn })).status).toBe(204);
    expect(fetched).toHaveBeenCalledTimes(21);
    byIp.reset();
  });

  it("rechaza por content-length sin leer el cuerpo", async () => {
    const fetched = vi.fn(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", fetched);
    byIp.reset();
    const r = req("{}");
    const text = vi.spyOn(r, "text");
    const big = new Request(r, {
      headers: { "content-type": "application/csp-report", "content-length": String(MAX_BODY + 1) },
    });
    const textBig = vi.spyOn(big, "text");
    expect((await handle(big, { sentryDsn: dsn })).status).toBe(204);
    expect(textBig).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
    expect(fetched).not.toHaveBeenCalled();
  });

  it("sin DSN, de otro tipo o demasiado grande no reenvía nada", async () => {
    const fetched = vi.fn(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", fetched);
    await handle(req("{}"), {});
    await handle(req("x", "text/plain"), { sentryDsn: dsn });
    await handle(req("x".repeat(MAX_BODY + 1)), { sentryDsn: dsn });
    expect(fetched).not.toHaveBeenCalled();
  });
});
