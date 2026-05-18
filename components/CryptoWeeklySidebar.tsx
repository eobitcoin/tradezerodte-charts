import Link from "next/link";

export type CryptoWeeklySidebarItem = {
  scanDay: string;
  tickerCount: number;
};

function fmtDate(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fmtWeekday(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
}

export default function CryptoWeeklySidebar({
  items,
  currentScanDay,
}: {
  items: CryptoWeeklySidebarItem[];
  currentScanDay?: string;
}) {
  return (
    <aside className="lg:sticky lg:top-6 lg:self-start space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50 px-1">
        Past weeks
      </h2>
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-black/15 dark:border-white/15 px-3 py-4 text-xs text-black/50 dark:text-white/50">
          No prior weekly posts yet.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => {
            const active = currentScanDay === item.scanDay;
            const Inner = (
              <div className="flex items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-mono text-sm font-semibold">{fmtDate(item.scanDay)}</span>
                  <span className="text-[10px] uppercase tracking-wide text-black/40 dark:text-white/40">
                    {fmtWeekday(item.scanDay)}
                  </span>
                </div>
                <span
                  className="shrink-0 inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                  title={`${item.tickerCount} ticker${item.tickerCount === 1 ? "" : "s"}`}
                >
                  {item.tickerCount}/3
                </span>
              </div>
            );
            return (
              <li key={item.scanDay}>
                {active ? (
                  <div className="block rounded-lg border-2 border-emerald-500/40 bg-emerald-500/[0.07] px-3 py-2.5">
                    {Inner}
                  </div>
                ) : (
                  <Link
                    href={`/crypto/weekly/${item.scanDay}`}
                    className="block rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] hover:border-black/20 dark:hover:border-white/20 px-3 py-2.5 transition-colors"
                  >
                    {Inner}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
