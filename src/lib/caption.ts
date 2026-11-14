import { geminiText } from "./gemini";

const SUPPORTED = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const PROMPT = "Write one short caption for this garden photo. No hashtags.";

export async function captionImage(bytes: Buffer, mime: string, hint: string): Promise<string> {
  const fallback = hint.trim()
    ? `Photo attached to: ${hint.trim().slice(0, 90)}`
    : "Photo from the garden.";
  if (!SUPPORTED.has(mime)) return fallback;
  try {
    const caption = process.env.GEMINI_API_KEY
      ? await captionWithGemini(bytes, mime)
      : process.env.ANTHROPIC_API_KEY
        ? await captionWithClaude(bytes, mime)
        : null;
    if (caption?.trim()) return caption.trim().slice(0, 180);
  } catch {
    return fallback;
  }
  return fallback;
}

async function captionWithGemini(bytes: Buffer, mime: string): Promise<string | null> {
  return geminiText(
    [{ inline_data: { mime_type: mime, data: bytes.toString("base64") } }, { text: PROMPT }],
    { maxOutputTokens: 80 },
    12_000,
  );
}

async function captionWithClaude(bytes: Buffer, mime: string): Promise<string | null> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const result = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
    max_tokens: 60,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mime as "image/jpeg", data: bytes.toString("base64") },
          },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  });
  const text = result.content.find((block) => block.type === "text");
  return text && text.type === "text" ? text.text : null;
}
