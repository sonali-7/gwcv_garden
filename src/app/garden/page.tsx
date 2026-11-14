import type { Metadata } from "next";
import { GardenView } from "@/components/GardenView";
import { getStore } from "@/lib/db";
import { loadGarden } from "@/lib/garden-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Garden view · GWCV garden",
  description: "The garden to scale: what's in each bed and what to plant next.",
};

export default async function GardenPage() {
  return <GardenView initial={await loadGarden(await getStore())} />;
}
