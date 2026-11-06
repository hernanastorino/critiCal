// Vercel function (Node): reads a syllabus PDF with Gemini (Google AI Studio free tier)
// and returns subjects, units and assessments for the app to preview. Nothing is
// stored here: the user confirms in the app.

import { clean, prompt, SCHEMA } from "../src/syllabus.js";
import { report } from "./_lib/report.js";
import { authenticate, type Caller, type Env, json, readBody, readEnv } from "./_lib/server.js";

const API = "https://generativelanguage.googleapis.com/v1beta/models";
/** Stable Flash first, then the lighter model if it is busy or unavailable. */
const MODELS = ["gemini-3.6-flash", "gemini-3.5-flash-lite"];
/** Vercel accepts request bodies up to 4.5 MB; base64 adds a third. */
export const MAX_PDF_BYTES = 3_000_000;

export function POST(req: Request): Promise<Response> {
  return handle(req, readEnv());
}

/**
 * Checks a Gemini key with a free call that lists the models it can use. Only a refusal
 * means a bad key; quota, outages and timeouts say nothing about it.
 */
async function validKey(key: string): Promise<boolean | "unavailable"> {
  try {
    const res = await fetch(`${API}?pageSize=1`, {
      headers: { "x-goog-api-key": key },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return true;
    return [400, 401, 403].includes(res.status) ? false : "unavailable";
  } catch {
    return "unavailable";
  }
}

/** The user's own key, or the app's when they have none. */
async function keyFor(caller: Caller, env: Env): Promise<{ key?: string; own: boolean }> {
  const { data, error } = await caller.admin.rpc("get_oauth_token", {
    p_user: caller.uid,
    p_provider: "gemini",
  });
  // Unreadable is not "has none": falling back would spend the app's quota.
  if (error) throw error;
  return typeof data === "string" && data
    ? { key: data, own: true }
    : { key: env.geminiKey, own: false };
}

/** Saves, removes or describes the user's own Gemini key. */
async function manageKey(caller: Caller, env: Env, body: Record<string, unknown>) {
  if (body.action === "key_status") {
    const { own } = await keyFor(caller, env);
    return json({ ok: true, own, fallback: !!env.geminiKey });
  }
  if (body.action === "clear_key") {
    const { error } = await caller.admin.rpc("delete_oauth_token", {
      p_user: caller.uid,
      p_provider: "gemini",
    });
    return error
      ? json({ ok: false, error: "key_failed" }, 500)
      : json({ ok: true, own: false, fallback: !!env.geminiKey });
  }
  const key = typeof body.key === "string" ? body.key.trim() : "";
  // Key formats change (AIza…, AQ.…): only junk is turned away here; Gemini decides.
  if (!/^[\x21-\x7e]{10,300}$/.test(key)) return json({ ok: false, error: "invalid_key" }, 400);
  const valid = await validKey(key);
  if (valid === "unavailable") return json({ ok: false, error: "gemini_busy" }, 503);
  if (!valid) return json({ ok: false, error: "invalid_key" }, 400);
  const { error } = await caller.admin.rpc("store_oauth_token", {
    p_user: caller.uid,
    p_provider: "gemini",
    p_token: key,
  });
  return error
    ? json({ ok: false, error: "key_failed" }, 500)
    : json({ ok: true, own: true, fallback: !!env.geminiKey });
}

export async function handle(req: Request, env: Env, now = Date.now()): Promise<Response> {
  const caller = await authenticate(req, env, []);
  if (caller instanceof Response) return caller;
  const body = await readBody(req);
  if (body.action === "set_key" || body.action === "clear_key" || body.action === "key_status") {
    try {
      return await manageKey(caller, env, body);
    } catch (e) {
      await report(env, e, "gemini-key");
      return json({ ok: false, error: "key_failed" }, 500);
    }
  }
  let key: string | undefined;
  try {
    ({ key } = await keyFor(caller, env));
  } catch (e) {
    await report(env, e, "gemini-key");
    return json({ ok: false, error: "key_failed" }, 500);
  }
  // Names only, never values: tells the operator which variable to set.
  if (!key) return json({ error: "server_not_configured", missing: ["geminiKey"] }, 503);
  const pdf = typeof body.pdf === "string" ? body.pdf : "";
  if (!pdf) return json({ ok: false, error: "missing_pdf" }, 400);
  if ((pdf.length * 3) / 4 > MAX_PDF_BYTES) return json({ ok: false, error: "too_large" }, 413);
  const year = new Date(now).getUTCFullYear();
  const request = JSON.stringify({
    contents: [
      {
        parts: [
          { inline_data: { mime_type: "application/pdf", data: pdf } },
          { text: prompt(year) },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      temperature: 0.2,
    },
  });
  // A forced model is the only one tried: the PDF never goes to another model.
  const models = env.geminiModel ? [env.geminiModel] : MODELS;
  try {
    for (const model of models) {
      const res = await fetch(`${API}/${model}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: request,
      });
      // Retired model, quota or overload: try the next one.
      // A forced model that does not exist will not start working by retrying.
      if (res.status === 404 && env.geminiModel)
        return json({ ok: false, error: "model_unavailable" }, 503);
      if ([404, 429, 500, 503].includes(res.status)) continue;
      // Upstream failure: a bad gateway for the app, with Gemini's own status in the body.
      if (!res.ok) return json({ ok: false, error: "gemini_error", status: res.status }, 502);
      const out = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const raw = out.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Unreadable answer: same as no answer.
      }
      const syllabus = clean(parsed);
      if (!syllabus) return json({ ok: false, error: "unreadable" });
      return json({ ok: true, model, syllabus });
    }
    return json({ ok: false, error: "gemini_busy" }, 503);
  } catch (e) {
    console.error(e);
    await report(env, e, "syllabus");
    return json({ ok: false, error: "syllabus_failed" }, 500);
  }
}
