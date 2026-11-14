import { createHmac, timingSafeEqual } from "node:crypto";

export type PhotonInbound = {
  eventId: string;
  phone: string;
  text: string;
  spaceId: string;
  agentId: string;
};

export function verifyStandardWebhook(
  rawBody: string,
  headers: { id: string; timestamp: string; signature: string },
  secret: string,
  nowMs = Date.now(),
): unknown {
  const timestamp = Number(headers.timestamp);
  if (!Number.isFinite(timestamp)) throw new Error("bad timestamp");
  if (Math.abs(nowMs / 1000 - timestamp) > 5 * 60) throw new Error("stale webhook");
  const material = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const key = Buffer.from(material, "base64");
  const expected = createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${rawBody}`).digest("base64");
  const ok = headers.signature.split(" ").some((part) => {
    const sig = part.startsWith("v1,") ? part.slice(3) : part;
    const left = Buffer.from(sig);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  });
  if (!ok) throw new Error("bad signature");
  return JSON.parse(rawBody) as unknown;
}

type Content = {
  type?: string;
  text?: string;
  format?: string;
  parts?: Content[];
};

function textOf(content: Content | undefined): string {
  if (!content) return "";
  if (content.type === "text" && typeof content.text === "string") return content.text;
  if (Array.isArray(content.parts)) return content.parts.map((part) => textOf(part)).filter(Boolean).join("\n");
  return "";
}

export function readPhotonInbound(event: unknown): PhotonInbound | { ignore: true } | null {
  if (!event || typeof event !== "object") return null;
  const record = event as {
    id?: string;
    type?: string;
    data?: { object?: Record<string, unknown> };
  };
  if (record.type !== "message.received") return { ignore: true };
  const message = record.data?.object;
  if (!message) return { ignore: true };
  const status = typeof message.status === "string" ? message.status : "received";
  if (status !== "received") return { ignore: true };
  const sentBy = message.sentBy as { handle?: string; kind?: string } | undefined;
  if (!sentBy?.handle || sentBy.kind === "agent") return { ignore: true };
  const receivedBy = message.receivedBy as { id?: string } | undefined;
  const space = message.space as { id?: string } | undefined;
  const spaceId = space?.id ?? (typeof message.spaceId === "string" ? message.spaceId : "");
  const agentId = receivedBy?.id ?? "";
  if (!spaceId || !agentId || !record.id) return null;
  return {
    eventId: record.id,
    phone: sentBy.handle,
    text: textOf(message.content as Content | undefined).trim(),
    spaceId,
    agentId,
  };
}
