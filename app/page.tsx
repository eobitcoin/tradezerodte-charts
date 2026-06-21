/**
 * `/` — Olivia Trades dashboard (logged-in landing page).
 *
 * Server component. Composes the hero video, market pulse, three research
 * surface snippets, and the cross-surface activity feed into a single view.
 * Everything is read-only; no client interactivity in this page. Reusable
 * sub-components live next to it in components/Dashboard*.
 */
import SiteHeader from "@/components/SiteHeader";
import DashboardView from "@/components/Dashboard/DashboardView";
import { loadDashboardData } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Olivia Trades — Dashboard",
  description:
    "Daily 0DTE research, weekly earnings setups, short-interest squeeze candidates, sector flow, and the latest activity across the Olivia Trades research suite.",
};

export default async function HomePage() {
  const data = await loadDashboardData();
  return (
    <>
      <SiteHeader />
      <DashboardView data={data} />
    </>
  );
}
