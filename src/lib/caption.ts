const SUPPORTED = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export async function captionImage(bytes: Buffer, mime: string, hint: string): Promise<string> {
  const fallback = hint.trim()
    ? `Photo attached to: ${hint.trim().slice(0, 90)}`
    : "Photo from the garden.";
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !SUPPORTED.has(mime)) return fallback;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: key });
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
            { type: "text", text: "Write one short caption for this garden photo. No hashtags." },
          ],
        },
      ],
    });
    const text = result.content.find((block) => block.type === "text");
    if (text && text.type === "text" && text.text.trim()) return text.text.trim().slice(0, 180);
  } catch {
    return fallback;
  }
  return fallback;
}
