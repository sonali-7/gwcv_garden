import { geminiText } from "./gemini";

const SUPPORTED = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const PROMPT = "Write one short caption for this garden photo. No hashtags.";

export async function captionImage(bytes: Buffer, mime: string, hint: string): Promise<string> {
  const fallback = hint.trim()
    ? `Photo attached to: ${hint.trim().slice(0, 90)}`
    : "Photo from the garden.";
  if (!SUPPORTED.has(mime)) return fallback;
  try {
    const caption = process.env.GEMINI_API_KEY ? await captionWithGemini(bytes, mime) : null;
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
