import { getStore } from "@/lib/db";
import { handleIncoming } from "@/lib/handle-message";
import { json } from "@/lib/http";
import { photonDailyLimit, photonReply, sendPhotonText } from "@/lib/photon";
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
  } catch (error) {
    // Photon does not retry most 4xx — a bad secret here permanently drops that delivery.
    console.warn(
      "Photon webhook rejected:",
      error instanceof Error ? error.message : "invalid",
      "(check PHOTON_WEBHOOK_SECRET matches this destination; Photon will not retry 400s)",
    );
    return json({ error: "Invalid webhook." }, 400);
  }

  const inbound = readPhotonInbound(event);
  if (!inbound || !("phone" in inbound) || !inbound.text) {
    console.warn("Photon webhook ignored: not a processable message.received (or empty text).");
    return json({ ok: true });
  }

  const store = await getStore();
  if (await store.hasSeenEvent(inbound.eventId)) return json({ ok: true });

  console.info("Photon message received, text length", inbound.text.length);
  const result = await handleIncoming(store, { phone: inbound.phone, text: inbound.text });
  await store.markEvent(inbound.eventId);

  const apiKey = process.env.PHOTON_API_KEY;
  const projectId = process.env.PHOTON_PROJECT_ID;
  const today = todayYmd(new Date());
  const before = await store.getConversation(inbound.phone);
  let count = before.sentToday?.day === today ? before.sentToday.count : 0;

  const reply = photonReply(result.replies, count, photonDailyLimit());
  if (apiKey && projectId && reply) {
    try {
      await sendPhotonText({
        apiKey,
        projectId,
        spaceId: inbound.spaceId,
        senderId: inbound.agentId,
        text: reply,
        idempotencyKey: inbound.eventId,
      });
      count += 1;
    } catch (error) {
      console.warn(error instanceof Error ? error.message : "Photon send failed");
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
