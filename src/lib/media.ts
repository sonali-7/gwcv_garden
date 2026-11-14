import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type SavedImage = {
  url: string;
  mime: string;
  bytes: Buffer;
};

export async function saveDataUrl(dataUrl: string): Promise<SavedImage | null> {
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (bytes.length < 16 || bytes.length > 4_000_000) return null;
  const ext = mime === "image/jpeg" ? "jpg" : mime.split("/")[1];
  const id = randomUUID();
  const dir = path.join(process.cwd(), "public", "uploads");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${id}.${ext}`), bytes);
  return { url: `/uploads/${id}.${ext}`, mime, bytes };
}
