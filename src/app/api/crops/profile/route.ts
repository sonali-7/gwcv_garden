import { checkProfile, knownPlant, plantName, PROFILE_SCHEMA, profilePrompt, registerCropProfiles } from "@/lib/crop-profiles";
import { canonicalCrop } from "@/lib/crops";
import { getStore } from "@/lib/db";
import { explainGeminiError, geminiText } from "@/lib/gemini";
import { json, noContent } from "@/lib/http";
import { addDays } from "@/lib/time";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function OPTIONS() {
  return noContent();
}

/**
 * Look up a plant the app doesn't know with Gemini and save it as a profile. Body: { name }.
 * Returns { profile } (new or already saved), or { known: true } if it's a built-in crop.
 * Plantings of it already in the garden get their harvest dates corrected to its real days to maturity.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const name = plantName(body?.name);
  if (!name) return json({ error: "Type a plant's name (letters only, up to 4 words)." }, 400);

  const store = await getStore();
  const saved = await store.listCropProfiles();
  const already = saved.find((p) => p.crop === name || p.aliases.includes(name));
  if (already) return json({ profile: already });
  if (knownPlant(name)) return json({ known: true, crop: canonicalCrop(name) });
  if (!process.env.GEMINI_API_KEY) return json({ error: "Add GEMINI_API_KEY to .env.local to look up new plants." }, 503);

  let raw: unknown;
  try {
    const text = await geminiText(
      [{ text: profilePrompt(name) }],
      // Room for the model's thinking as well as the answer; too little and the answer comes back empty.
      { temperature: 0.2, maxOutputTokens: 4000, responseMimeType: "application/json", responseSchema: PROFILE_SCHEMA },
      25_000,
      20_000,
    );
    raw = text?.trim() ? JSON.parse(text) : null;
  } catch (error) {
    console.error("[crops] Gemini failed:", error instanceof Error ? error.message : error);
    return json({ error: error instanceof SyntaxError ? "Gemini's answer was garbled. Try again." : explainGeminiError(error) }, 502);
  }
  const profile = checkProfile(raw, name);
  if (profile === "not a plant") return json({ error: `Gemini doesn't think “${name}” is something you'd grow in a garden.` }, 422);
  if (!profile) {
    console.warn("[crops] unusable profile for", JSON.stringify(name), JSON.stringify(raw)?.slice(0, 400));
    return json({ error: "Gemini didn't come back with anything usable. Try again." }, 502);
  }
  // Gemini may name it as a crop the app already has (e.g. "zucchini" → "squash"): use that instead.
  if (knownPlant(profile.crop)) return json({ known: true, crop: canonicalCrop(profile.crop) });

  await store.saveCropProfile(profile);
  registerCropProfiles([profile]);

  // Plantings of this plant made before it had a profile were timed with a 60-day guess: fix their harvest dates.
  const names = new Set([profile.crop, ...profile.aliases]);
  for (const p of await store.listPlantings()) {
    if (p.removed_date || !names.has(p.crop.toLowerCase())) continue;
    await store.updatePlanting({
      ...p,
      crop: profile.crop,
      days_to_maturity: profile.daysToMaturity,
      expected_harvest_date: addDays(p.planted_date, profile.daysToMaturity),
    });
  }
  return json({ profile }, 201);
}
