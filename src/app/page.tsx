import { Dashboard } from "@/components/Dashboard";
import { loadDashboard } from "@/lib/dashboard-data";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Page() {
  const data = await loadDashboard(await getStore(), null);
  return <Dashboard initial={data} />;
}
