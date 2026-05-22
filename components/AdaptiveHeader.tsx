import { getCurrentUser } from "@/lib/auth";
import SiteHeader from "./SiteHeader";
import PublicHeader from "./PublicHeader";

/**
 * Renders the right header for a page that's reachable both publicly and from
 * inside the authenticated app (e.g. /morning-brief).
 *
 * - Logged-in user  → SiteHeader (full app nav — Today, Calendar, Admin, etc.)
 * - Logged-out visitor → PublicHeader (marketing nav — Login / Sign up)
 *
 * Keeps the page body identical for both; only the nav chrome adapts, so a
 * signed-in user never gets stranded on public chrome with no way back.
 */
export default async function AdaptiveHeader() {
  const user = await getCurrentUser();
  return user ? <SiteHeader /> : <PublicHeader />;
}
