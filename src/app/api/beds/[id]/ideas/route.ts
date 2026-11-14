import { checkIdeas, IDEA_SCHEMA, ideaContext, ideaPrompt } from "@/lib/bed-ideas";
import { getStore } from "@/lib/db";
import { explainGeminiError, geminiText } from "@/lib/gemini";
import { json, noContent } from "@/lib/http";
import { gardenTz, todayYmd } from "@/lib/time";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export function OPTIONS() {
  return noContent();
}

/**
 * Ask Gemini for crops that suit this bed on a date: the month and season, companions for what's in and next
 * to the bed, and rotation. Body: { day: "YYYY-MM-DD" } (the timeline date; defaults to today).
 */
export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!process.env.GEMINI_API_KEY) return json({ error: "Add GEMINI_API_KEY to .env.local to get ideas from Gemini." }, 503);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const today = todayYmd(new Date(), gardenTz());
  const asked = typeof body?.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : today;
  const day = asked < today ? today : asked;
  const store = await getStore();
  const [beds, plantings, layout] = await Promise.all([store.listBeds(), store.listPlantings(), store.getLayout()]);
  const bed = beds.find((item) => item.id === id && !item.archived);
  if (!bed) return json({ error: "That bed is gone." }, 404);
  const context = ideaContext(bed, beds, plantings, layout, day, today);
  try {
    const text = await geminiText(
      [{ text: ideaPrompt(context) }],
      { temperature: 0.4, maxOutputTokens: 2000, responseMimeType: "application/json", responseSchema: IDEA_SCHEMA },
      25_000,
      20_000,
    );
    const ideas = text?.trim() ? checkIdeas(JSON.parse(text), context, day, today) : [];
    if (!ideas.length) return json({ error: "Gemini didn't come back with anything usable. Try again." }, 502);
    return json({ day, ideas });
  } catch (error) {
    console.error("[ideas] Gemini failed:", error instanceof Error ? error.message : error);
    return json({ error: error instanceof SyntaxError ? "Gemini's answer was garbled. Try again." : explainGeminiError(error) }, 502);
  }
}
