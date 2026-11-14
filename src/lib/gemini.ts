const BUSY = new Set([429, 500, 503, 504]);

type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

export function geminiModels(): string[] {
  const primary = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const backup = process.env.GEMINI_FALLBACK_MODEL || "gemini-flash-lite-latest";
  return primary === backup ? [primary] : [primary, backup];
}

/**
 * Ask Gemini, trying GEMINI_MODEL and then GEMINI_FALLBACK_MODEL if the first is busy or slow.
 * `timeoutMs` is the last model's limit; the first model gets `primaryTimeoutMs` (4 seconds by default, for quick texts).
 * Returns null without an API key. Throws "Gemini <status>" when every model fails.
 */
export async function geminiText(
  parts: GeminiPart[],
  generationConfig: Record<string, unknown>,
  timeoutMs: number,
  primaryTimeoutMs = Math.min(timeoutMs, 4_000),
): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  let lastStatus = 0;
  const models = geminiModels();
  for (const [index, model] of models.entries()) {
    const last = index === models.length - 1;
    let response: Response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          signal: AbortSignal.timeout(last ? timeoutMs : primaryTimeoutMs),
          body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig }),
        },
      );
    } catch (error) {
      if (last) throw error;
      continue;
    }
    if (response.ok) {
      const body = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      return body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? null;
    }
    lastStatus = response.status;
    if (!BUSY.has(response.status)) break;
  }
  throw new Error(`Gemini ${lastStatus}`);
}
