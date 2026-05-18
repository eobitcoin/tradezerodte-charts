import Link from "next/link";
import { redirect } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import BotWickTabs from "@/components/BotWickTabs";
import BotWickUserView from "@/components/BotWickUserView";
import BotWickAdminView from "@/components/BotWickAdminView";
import BotWickSignalsView from "@/components/BotWickSignalsView";
import BotWickBacktestView from "@/components/BotWickBacktestView";
import BotWickPnlView from "@/components/BotWickPnlView";
import BotWickArchiveView from "@/components/BotWickArchiveView";
import { getCurrentUser } from "@/lib/auth";
import {
  deriveStatus,
  getActiveBotTrades,
  getAlmaReadyStates,
  getBotConfig,
  getRecentBotActions,
} from "@/lib/botwick";
import { getCredsStatus } from "@/lib/botwick/tradier-adapter";

// Bot status mutates server-side at runtime, so disable ISR.
export const dynamic = "force-dynamic";

type ActiveTab = "activity" | "signals" | "backtest" | "config" | "archive" | "pnl";
type Search = { tab?: string };

/**
 * Map a query-string `tab` to one of our valid tabs. Non-admins are
 * silently routed to `activity` regardless of what they requested — there's
 * no flicker / login redirect for a tab they can't see.
 */
function resolveTab(raw: string | undefined, isAdmin: boolean): ActiveTab {
  if (isAdmin && raw === "signals") return "signals";
  if (isAdmin && raw === "backtest") return "backtest";
  if (isAdmin && (raw === "config" || raw === "admin")) return "config";
  if (isAdmin && raw === "archive") return "archive";
  if (isAdmin && raw === "pnl") return "pnl";
  // Backwards-compat: old links still pointing to ?tab=user / ?tab=admin
  return "activity";
}

export default async function BotWickPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?next=/botwick");
  }

  const { tab } = await searchParams;
  const isAdmin = user.role === "admin";
  const activeTab = resolveTab(tab, isAdmin);

  // All three views need config; activity needs actions+trades; signals
  // needs only config; config view needs creds. Fetch in parallel.
  const [config, actions, trades, almaStates] = await Promise.all([
    getBotConfig(),
    getRecentBotActions(60),
    getActiveBotTrades(25),
    getAlmaReadyStates(),
  ]);
  const status = deriveStatus(config);

  return (
    <>
      <SiteHeader />
      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between gap-3">
          <BotWickTabs active={activeTab} isAdmin={isAdmin} />
          <Link
            href="/botwick/help"
            className="shrink-0 text-xs text-black/55 dark:text-white/55 hover:text-black dark:hover:text-white hover:underline"
          >
            Help · how it works →
          </Link>
        </div>
        {activeTab === "activity" && (
          <BotWickUserView
            status={status}
            config={config}
            actions={actions}
            trades={trades}
            almaStates={almaStates}
            isAdmin={isAdmin}
          />
        )}
        {activeTab === "signals" && (
          <BotWickSignalsView active={config.activeSignalStrategy} />
        )}
        {activeTab === "backtest" && <BotWickBacktestView config={config} />}
        {activeTab === "config" && (
          <BotWickAdminView config={config} status={status} creds={getCredsStatus()} />
        )}
        {activeTab === "archive" && <BotWickArchiveView />}
        {activeTab === "pnl" && <BotWickPnlView />}
      </main>
    </>
  );
}
