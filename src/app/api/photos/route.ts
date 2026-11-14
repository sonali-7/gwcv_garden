import { getStore } from "@/lib/db";
import { json, noContent } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function OPTIONS() {
  return noContent();
}

export async function GET() {
  const store = await getStore();
  const [photos, people, sessions] = await Promise.all([
    store.listPhotos(),
    store.listPeople(),
    store.listSessions(),
  ]);
  return json(
    photos.map((photo) => {
      const session = sessions.find((item) => item.id === photo.session_id);
      const person = people.find((item) => item.id === photo.person_id);
      return {
        id: photo.id,
        session_id: photo.session_id,
        person_id: photo.person_id,
        person_name: person?.name ?? null,
        url: photo.url,
        caption: photo.caption,
        taken_at: photo.taken_at,
        bed_id: session?.bed_id ?? null,
        planting_id: session?.planting_id ?? null,
      };
    }),
  );
}
