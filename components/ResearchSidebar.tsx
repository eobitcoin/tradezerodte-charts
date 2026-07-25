import Link from "next/link";

export type ResearchSidebarItem = {
  ticker: string;
  scanDay: string;
  headline: string;
  imageCount: number;
};

function fmtDate(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
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

export default function ResearchSidebar({
  items,
  currentScanDay,
  currentTicker,
  hrefFor,
}: {
  items: ResearchSidebarItem[];
  currentScanDay?: string;
  currentTicker?: string;
  /** Build the link for a sidebar row. Defaults to the equity research
   *  URL pattern; metals pages override with /research/metals/... so
   *  navigating between rows stays inside the metals stream. */
  hrefFor?: (item: ResearchSidebarItem) => string;
}) {
  const buildHref =
    hrefFor ?? ((item: ResearchSidebarItem) => `/research/${item.scanDay}/${item.ticker}`);
  // Group by date desc; within each date list tickers alpha asc.
  const groups = new Map<string, ResearchSidebarItem[]>();
  for (const it of items) {
    const arr = groups.get(it.scanDay) ?? [];
    arr.push(it);
    groups.set(it.scanDay, arr);
  }
  const orderedDays = [...groups.keys()].sort((a, b) => (a < b ? 1 : -1));
  for (const day of orderedDays) {
    groups.get(day)!.sort((a, b) => a.ticker.localeCompare(b.ticker));
  }

  const empty = items.length === 0;

  // The grouped day → ticker list. Rendered identically on mobile (inside the
  // collapsible disclosure) and desktop (in the sticky rail) so there's a
  // single source of truth for the markup.
  const list = empty ? (
    <div className="rounded-lg border border-dashed border-black/15 dark:border-white/15 px-3 py-4 text-xs text-black/50 dark:text-white/50">
      No research posts yet. The Wicked Research routine runs daily.
    </div>
  ) : (
    <div className="space-y-4">
      {orderedDays.map((day) => (
        <div key={day} className="space-y-1.5">
          <div className="px-1 flex items-baseline gap-1.5">
            <span className="font-mono text-xs font-semibold text-black/70 dark:text-white/70">
              {fmtDate(day)}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-black/40 dark:text-white/40">
              {fmtWeekday(day)}
            </span>
          </div>
          <ul className="space-y-1">
            {groups.get(day)!.map((item) => {
              const active =
                currentScanDay === item.scanDay && currentTicker === item.ticker;
              return (
                <li key={`${item.scanDay}-${item.ticker}`}>
                  {active ? (
                    <div className="block rounded-lg border-2 border-emerald-500/40 bg-emerald-500/[0.07] dark:bg-emerald-500/[0.08] px-3 py-2.5">
                      <RowContent item={item} active />
                    </div>
                  ) : (
                    <Link
                      href={buildHref(item)}
                      className="block rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] hover:border-black/20 dark:hover:border-white/20 px-3 py-2.5 transition-colors"
                    >
                      <RowContent item={item} active={false} />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );

  return (
    // order-first pulls the switcher ABOVE the article on mobile's single
    // column (so changing tickers doesn't require scrolling past the whole
    // writeup); lg:order-none restores natural right-column placement on
    // desktop, where the full rail is used instead.
    <aside className="order-first lg:order-none lg:sticky lg:top-6 lg:self-start">
      {/* Mobile: an always-visible, horizontally scrollable strip of ticker
          chips — no tap-to-expand. Sticky under the header so you can jump
          to any ticker at any scroll position. Hidden on desktop. */}
      {!empty && (
        <div className="lg:hidden -mx-4 sm:mx-0 sticky top-0 z-20 bg-white/95 dark:bg-black/95 backdrop-blur border-b border-black/10 dark:border-white/10">
          <div className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">
            Browse research — tap a ticker
          </div>
          <div className="flex gap-2 overflow-x-auto px-4 pb-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {orderedDays.map((day) =>
              groups.get(day)!.map((item) => {
                const active =
                  currentScanDay === item.scanDay && currentTicker === item.ticker;
                const chip =
                  "shrink-0 flex flex-col items-start rounded-lg border px-3 py-1.5 leading-tight " +
                  (active
                    ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : "border-black/15 dark:border-white/20 bg-black/[0.03] dark:bg-white/[0.06] text-black/80 dark:text-white/80");
                return active ? (
                  <div key={`m-${item.scanDay}-${item.ticker}`} className={chip} aria-current="true">
                    <span className="font-mono text-sm font-bold">{item.ticker}</span>
                    <span className="text-[10px] opacity-70">{fmtDate(item.scanDay)}</span>
                  </div>
                ) : (
                  <Link
                    key={`m-${item.scanDay}-${item.ticker}`}
                    href={buildHref(item)}
                    className={chip}
                  >
                    <span className="font-mono text-sm font-bold">{item.ticker}</span>
                    <span className="text-[10px] opacity-70">{fmtDate(item.scanDay)}</span>
                  </Link>
                );
              }),
            )}
          </div>
        </div>
      )}

      {/* Desktop: the sticky vertical rail, exactly as before. */}
      <div className="hidden lg:block space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50 px-1">
          Research
        </h2>
        {list}
      </div>
    </aside>
  );
}

function RowContent({ item, active }: { item: ResearchSidebarItem; active: boolean }) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={`font-mono text-sm font-semibold ${active ? "" : "text-black/80 dark:text-white/80"}`}
        >
          {item.ticker}
        </span>
        {item.imageCount > 0 && (
          <span
            className="shrink-0 inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-black/5 dark:bg-white/10 text-black/50 dark:text-white/50"
            title={`${item.imageCount} chart${item.imageCount === 1 ? "" : "s"}`}
          >
            {item.imageCount}c
          </span>
        )}
      </div>
      {item.headline && (
        <p className="mt-1 text-[11px] leading-snug text-black/55 dark:text-white/55 line-clamp-2">
          {item.headline}
        </p>
      )}
    </>
  );
}
