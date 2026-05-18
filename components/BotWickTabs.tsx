import Link from "next/link";

type Props = {
  active: "activity" | "signals" | "backtest" | "config" | "archive" | "pnl";
  isAdmin: boolean;
};

/**
 * BotWick top-level tabs.
 *
 * ACTIVITY — always visible, always clickable. Live status + Matrix tape.
 *
 * SIGNALS / BACKTEST / CONFIG — always *labeled* (so non-admins know admin
 * surfaces exist), but visually disabled and non-clickable for non-admins.
 * Defense in depth: `resolveTab()` in page.tsx routes non-admins back to
 * activity even if they craft the URL.
 */
export default function BotWickTabs({ active, isAdmin }: Props) {
  const cls = (tab: Props["active"]) =>
    [
      "px-4 py-2 -mb-px border-b-2 text-sm font-mono uppercase tracking-widest transition-colors",
      tab === active
        ? "border-emerald-500 text-emerald-400"
        : "border-transparent text-black/55 dark:text-white/55 hover:text-black dark:hover:text-white hover:border-black/20 dark:hover:border-white/20",
    ].join(" ");

  const disabledCls =
    "px-4 py-2 -mb-px border-b-2 border-transparent text-sm font-mono uppercase tracking-widest text-black/30 dark:text-white/30 cursor-not-allowed select-none inline-flex items-center gap-1.5";

  const adminBadge = (
    <span className="ml-1 text-[9px] tracking-widest uppercase border border-black/15 dark:border-white/15 rounded px-1 py-[1px] opacity-70">
      admin
    </span>
  );

  return (
    <nav className="border-b border-black/10 dark:border-white/10 flex gap-2 flex-wrap">
      <Link href="/botwick?tab=activity" className={cls("activity")}>
        Activity
      </Link>
      {isAdmin ? (
        <Link href="/botwick?tab=signals" className={cls("signals")}>
          Signals
        </Link>
      ) : (
        <span className={disabledCls} title="Admin only" aria-disabled="true">
          Signals {adminBadge}
        </span>
      )}
      {isAdmin ? (
        <Link href="/botwick?tab=backtest" className={cls("backtest")}>
          Backtest
        </Link>
      ) : (
        <span className={disabledCls} title="Admin only" aria-disabled="true">
          Backtest {adminBadge}
        </span>
      )}
      {isAdmin ? (
        <Link href="/botwick?tab=config" className={cls("config")}>
          Config
        </Link>
      ) : (
        <span className={disabledCls} title="Admin only" aria-disabled="true">
          Config {adminBadge}
        </span>
      )}
      {isAdmin ? (
        <Link href="/botwick?tab=archive" className={cls("archive")}>
          Archive
        </Link>
      ) : (
        <span className={disabledCls} title="Admin only" aria-disabled="true">
          Archive {adminBadge}
        </span>
      )}
      {isAdmin ? (
        <Link href="/botwick?tab=pnl" className={cls("pnl")}>
          P&amp;L
        </Link>
      ) : (
        <span className={disabledCls} title="Admin only" aria-disabled="true">
          P&amp;L {adminBadge}
        </span>
      )}
    </nav>
  );
}
