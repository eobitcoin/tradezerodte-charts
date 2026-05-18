import Link from "next/link";
import { and, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, type Trade } from "@/lib/db/schema";
import { nyMonthRange, todayMonth, nyTradingDay } from "@/lib/trading-day";
import { gradeColors, sortTradesByGrade } from "@/lib/grade";
import SiteHeader from "@/components/SiteHeader";

export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-\d{2}$/;

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function buildGrid(month: string) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const startWeekday = first.getUTCDay(); // 0=Sun
  const cells: ({ date: string; day: number } | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= lastDay; d++) {
    const date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ date, day: d });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const params = await searchParams;
  const requested = params.month && MONTH_RE.test(params.month) ? params.month : todayMonth();
  const { start, end } = nyMonthRange(requested);
  const today = nyTradingDay();

  const rows = await db
    .select({ tradingDay: posts.tradingDay, trades: posts.trades })
    .from(posts)
    .where(and(gte(posts.tradingDay, start), lte(posts.tradingDay, end)));

  const byDay = new Map<string, Trade[]>();
  for (const r of rows) byDay.set(r.tradingDay, sortTradesByGrade((r.trades || []) as Trade[]));

  const cells = buildGrid(requested);
  const prev = shiftMonth(requested, -1);
  const next = shiftMonth(requested, +1);
  const [yy, mm] = requested.split("-").map(Number);
  const monthLabel = new Date(Date.UTC(yy, mm - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <>
      <SiteHeader />
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">{monthLabel}</h1>
          <div className="flex gap-2 text-sm">
            <Link
              href={`/calendar?month=${prev}`}
              className="px-3 py-1.5 rounded border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
            >
              ← {prev}
            </Link>
            <Link
              href={`/calendar?month=${todayMonth()}`}
              className="px-3 py-1.5 rounded border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
            >
              Today
            </Link>
            <Link
              href={`/calendar?month=${next}`}
              className="px-3 py-1.5 rounded border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
            >
              {next} →
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-7 text-xs uppercase tracking-wide text-black/50 dark:text-white/50">
          {weekdays.map((w) => (
            <div key={w} className="px-2 py-1">{w}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-2">
          {cells.map((cell, i) => {
            if (!cell) return <div key={i} className="aspect-[4/3]" />;
            const trades = byDay.get(cell.date);
            const hasPost = !!trades && trades.length > 0;
            const top3 = (trades || []).slice(0, 3);
            const isToday = cell.date === today;
            const inner = (
              <div
                className={[
                  "aspect-[4/3] p-2 rounded border flex flex-col gap-1.5 transition-colors",
                  hasPost
                    ? "border-black/15 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                    : "border-black/5 dark:border-white/5 text-black/40 dark:text-white/40",
                  isToday ? "ring-2 ring-blue-500/60" : "",
                ].join(" ")}
              >
                <div className="text-xs font-medium">{cell.day}</div>
                {hasPost && (
                  <div className="flex flex-col gap-1">
                    {top3.map((t) => {
                      const gc = gradeColors(t.grade);
                      return (
                        <div
                          key={t.ticker + (t.rank ?? "")}
                          className={`flex items-center gap-1.5 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border ${gc.pill}`}
                        >
                          <span className="shrink-0">{t.grade}</span>
                          <span className="truncate">{t.ticker}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
            return hasPost ? (
              <Link key={i} href={`/posts/${cell.date}`}>{inner}</Link>
            ) : (
              <div key={i}>{inner}</div>
            );
          })}
        </div>
      </main>
    </>
  );
}
