import { afterEach, describe, expect, it, vi } from "vitest";
import { byIp, handle, MAX_BODY, summary } from "./csp-report.js";

const dsn = "https://abc@o1.ingest.sentry.io/42";
const req = (body: string, type = "application/csp-report") =>
  new Request("https://x.test/api/csp-report", {
    method: "POST",
    headers: { "content-type": type },
    body,
  });

describe("csp-report", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resume la violación en una línea, en los dos formatos", () => {
    const legacy =
      '{"csp-report":{"violated-directive":"connect-src","blocked-uri":"https://x.test"}}';
    const modern =
      '[{"type":"csp-violation","body":{"effectiveDirective":"img-src","blockedURL":"data"}}]';
    expect(summary(legacy)).toBe("CSP: connect-src blocked https://x.test");
    expect(summary(modern)).toBe("CSP: img-src blocked data");
    expect(summary("nada")).toBe("CSP: ? blocked ?");
  });

  it("funciona con un DSN de Better Stack", async () => {
    const fetched = vi.fn((_url: string) => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", fetched);
    byIp.reset();
    const bs = "https://tok@s2842817.us-west-2a.betterstackdata.com/2842817";
    expect((await handle(req("{}"), { sentryDsn: bs })).status).toBe(204);
    expect(fetched.mock.calls[0]?.[0]).toBe(
      "https://s2842817.us-west-2a.betterstackdata.com/api/2842817/envelope/",
    );
  });

  it("manda el reporte como error y responde 204", async () => {
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

  it("no archiva texto ajeno: la directiva y la dirección tienen que verse como las de un navegador", () => {
    const evil = JSON.stringify({
      "csp-report": {
        "violated-directive": "connect-src\nFATAL: llamá al 099",
        "blocked-uri": "https://x.test\nOtra línea con espacios",
      },
    });
    expect(summary(evil)).toBe("CSP: ? blocked ?");
    expect(summary('{"csp-report":{"violated-directive":"img-src","blocked-uri":"inline"}}')).toBe(
      "CSP: img-src blocked inline",
    );
  });

  it("un cuerpo por partes (sin content-length) se corta al pasar el límite", async () => {
    const fetched = vi.fn(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", fetched);
    byIp.reset();
    let sent = 0;
    const chunk = new TextEncoder().encode("x".repeat(4096));
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength;
        controller.enqueue(chunk);
        // A body that never ends: only the limit stops the reading.
        if (sent > MAX_BODY * 100) controller.close();
      },
    });
    const chunked = new Request("https://x.test/api/csp-report", {
      method: "POST",
      headers: { "content-type": "application/csp-report" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect((await handle(chunked, { sentryDsn: dsn })).status).toBe(204);
    expect(fetched).not.toHaveBeenCalled();
    expect(sent).toBeLessThan(MAX_BODY * 3);
  });
});
