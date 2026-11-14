import { getStore } from "@/lib/db";
import { json, noContent } from "@/lib/http";
import { toPublicPerson } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function OPTIONS() {
  return noContent();
}

export async function GET() {
  const people = await (await getStore()).listPeople();
  return json(people.map(toPublicPerson));
}
