import { randomUUID } from "node:crypto";

const DEFAULT_DAILY_LIMIT = 100;

export const LIMIT_NOTICE = "That's my last reply today. I'll keep logging what you send.";

export function photonDailyLimit(): number {
  const value = Number(process.env.PHOTON_DAILY_LIMIT);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_DAILY_LIMIT;
}

export function photonReply(replies: string[], sentToday: number, limit: number): string | null {
  const text = replies.join("\n").trim();
  if (!text || sentToday >= limit) return null;
  return sentToday === limit - 1 ? `${text}\n\n${LIMIT_NOTICE}` : text;
}

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
    let code = "";
    try {
      const problem = (await response.json()) as { code?: string; title?: string };
      code = problem.code || problem.title || "";
    } catch {
      code = "";
    }
    const hint = input.projectId.startsWith("pho_prj_")
      ? ""
      : " PHOTON_PROJECT_ID should start with pho_prj_ (Settings in the Photon dashboard).";
    throw new Error(`Photon send failed (${response.status}${code ? ` ${code}` : ""}).${hint}`);
  }
}
