import { CROP_FAMILIES } from "@/lib/crops";
import { json, noContent } from "@/lib/http";

export function OPTIONS() {
  return noContent();
}

export function GET() {
  return json(CROP_FAMILIES);
}
