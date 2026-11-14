import { randomUUID } from "node:crypto";

export const PHOTON_DAILY_LIMIT = 12;

export async function sendPhotonText(input: {
  projectId: string;
  apiKey: string;
  spaceId: string;
  senderId: string;
  text: string;
  idempotencyKey?: string;
}): Promise<void> {
  const response = await fetch(`https://api.photon.codes/v1/projects/${input.projectId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey || randomUUID(),
    },
    body: JSON.stringify({
      spaceId: input.spaceId,
      senderId: input.senderId,
      content: { type: "text", format: "plain", text: input.text },
    }),
  });
  if (!response.ok) {
    throw new Error(`Photon send failed (${response.status})`);
  }
}
