import { simulatorAdapter } from "@/channels/adapter";
import { captionImage } from "@/lib/caption";
import { getStore } from "@/lib/db";
import { handleIncoming, phoneForNewVolunteer } from "@/lib/handle-message";
import { json } from "@/lib/http";
import { saveDataUrl } from "@/lib/media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    personId?: unknown;
    asNew?: unknown;
    text?: unknown;
    imageDataUrl?: unknown;
  } | null;
  if (!body) return json({ error: "Send a text." }, 400);
  const text = typeof body.text === "string" ? body.text.slice(0, 1000) : "";
  const store = await getStore();

  let phone: string | null = null;
  if (body.asNew === true) {
    phone = await phoneForNewVolunteer(store);
  } else if (typeof body.personId === "string") {
    const person = await store.getPerson(body.personId);
    if (!person) return json({ error: "Pick who is texting." }, 400);
    phone = person.phone;
  } else {
    return json({ error: "Pick who is texting." }, 400);
  }

  let image: { url: string; caption: string } | null = null;
  if (typeof body.imageDataUrl === "string" && body.imageDataUrl.length > 0) {
    const saved = await saveDataUrl(body.imageDataUrl);
    if (!saved) return json({ error: "Send a jpg, png, webp, or gif under 4MB." }, 400);
    image = { url: saved.url, caption: await captionImage(saved.bytes, saved.mime, text) };
  }

  const result = await handleIncoming(store, { phone, text, image });
  for (const reply of result.replies) {
    await simulatorAdapter.send({ phone, text: reply });
  }
  const thread = await store.getThread(phone);
  return json({
    replies: result.replies,
    thread,
    sessionId: result.session?.id ?? null,
    sessionStart: result.session?.start ?? null,
    personId: result.person?.id ?? null,
  });
}
