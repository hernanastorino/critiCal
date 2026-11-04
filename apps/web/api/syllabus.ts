// Vercel function (Node): reads a syllabus PDF with Gemini (Google AI Studio free tier)
// and returns subjects, units and assessments for the app to preview. Nothing is
// stored here: the user confirms in the app.

import { clean, prompt, SCHEMA } from "../src/syllabus.js";
import { report } from "./_lib/report.js";
import { authenticate, type Env, json, readBody, readEnv } from "./_lib/server.js";

const API = "https://generativelanguage.googleapis.com/v1beta/models";
/** Stable Flash first, then the lighter model if it is busy or unavailable. */
const MODELS = ["gemini-3.6-flash", "gemini-3.5-flash-lite"];
/** Vercel accepts request bodies up to 4.5 MB; base64 adds a third. */
export const MAX_PDF_BYTES = 3_000_000;

export function POST(req: Request): Promise<Response> {
  return handle(req, readEnv());
}

export async function handle(req: Request, env: Env, now = Date.now()): Promise<Response> {
  const caller = await authenticate(req, env, ["geminiKey"]);
  if (caller instanceof Response) return caller;
  const body = await readBody(req);
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
        headers: { "x-goog-api-key": env.geminiKey as string, "Content-Type": "application/json" },
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
