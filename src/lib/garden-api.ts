import type { Bed } from "./types";

export function cleanName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const name = value.replace(/\s+/g, " ").trim().slice(0, 60);
  return name || fallback;
}

export function cleanGeometry(value: unknown, widthFt: number, lengthFt: number): Bed["geometry"] {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const nums = ["x", "y", "w", "h"].map((key) => Number(raw[key]));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const round = (n: number) => Math.round(n * 2) / 2;
  const w = Math.min(Math.max(round(nums[2]), 1), widthFt);
  const h = Math.min(Math.max(round(nums[3]), 1), lengthFt);
  const x = Math.min(Math.max(round(nums[0]), 0), widthFt - w);
  const y = Math.min(Math.max(round(nums[1]), 0), lengthFt - h);
  return { x, y, w, h };
}
