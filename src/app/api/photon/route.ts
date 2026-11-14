import { getStore } from "@/lib/db";
import { handleIncoming } from "@/lib/handle-message";
import { json } from "@/lib/http";
import { PHOTON_DAILY_LIMIT, sendPhotonText } from "@/lib/photon";
import { todayYmd } from "@/lib/time";
import { readPhotonInbound, verifyStandardWebhook } from "@/lib/webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.PHOTON_WEBHOOK_SECRET;
  if (!secret) return json({ error: "Photon webhook is not configured." }, 500);

  const raw = await request.text();
  let event: unknown;
  try {
    event = verifyStandardWebhook(raw, {
      id: request.headers.get("webhook-id") ?? "",
      timestamp: request.headers.get("webhook-timestamp") ?? "",
      signature: request.headers.get("webhook-signature") ?? "",
    }, secret);
  } catch {
    return json({ error: "Invalid webhook." }, 400);
  }

  const inbound = readPhotonInbound(event);
  if (!inbound || !("phone" in inbound) || !inbound.text) return json({ ok: true });

  const store = await getStore();
  if (await store.hasSeenEvent(inbound.eventId)) return json({ ok: true });

  const result = await handleIncoming(store, { phone: inbound.phone, text: inbound.text });
  await store.markEvent(inbound.eventId);

  const apiKey = process.env.PHOTON_API_KEY;
  const projectId = process.env.PHOTON_PROJECT_ID;
  const today = todayYmd(new Date());
  const before = await store.getConversation(inbound.phone);
  let count = before.sentToday?.day === today ? before.sentToday.count : 0;

  if (apiKey && projectId) {
    for (const [index, reply] of result.replies.entries()) {
      if (count >= PHOTON_DAILY_LIMIT) break;
      try {
        await sendPhotonText({
          apiKey,
          projectId,
          spaceId: inbound.spaceId,
          senderId: inbound.agentId,
          text: reply,
          idempotencyKey: `${inbound.eventId}:${index}`,
        });
        count += 1;
      } catch (error) {
        console.warn(error instanceof Error ? error.message : "Photon send failed");
        break;
      }
    }
  }

  const latest = await store.getConversation(inbound.phone);
  await store.saveConversation(inbound.phone, {
    ...latest,
    photon: { spaceId: inbound.spaceId, agentId: inbound.agentId },
    sentToday: { day: today, count },
  });
  return json({ ok: true });
}
