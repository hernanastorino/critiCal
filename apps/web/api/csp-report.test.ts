import { afterEach, describe, expect, it, vi } from "vitest";
import { handle, MAX_BODY, securityUrl } from "./csp-report.js";

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
    const fetched = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetched);
    const res = await handle(req('{"csp-report":{}}'), { sentryDsn: dsn });
    expect(res.status).toBe(204);
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it("sin DSN, de otro tipo o demasiado grande no reenvía nada", async () => {
    const fetched = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetched);
    await handle(req("{}"), {});
    await handle(req("x", "text/plain"), { sentryDsn: dsn });
    await handle(req("x".repeat(MAX_BODY + 1)), { sentryDsn: dsn });
    expect(fetched).not.toHaveBeenCalled();
  });
});
