import { NextResponse } from "next/server";
import { z } from "zod";
import { requireIngestBearer } from "@/lib/bearer";
import { renderMarkdown } from "@/lib/markdown";
import { buildTradesTableHtml } from "@/lib/email-render";
import { sendDteResearchEmail } from "@/lib/email";
import { getPostByDayKind } from "@/lib/scans";
import { nyTradingDay } from "@/lib/trading-day";
import type { ScanKind, Trade } from "@/lib/db/schema";

export const runtime = "nodejs";

/**
 * POST /api/posts/email-latest
 *
 * Bearer-protected. Sends the daily research email for a given (day, scan_kind)
 * to the recipients in `DTE_RESEARCH_EMAIL_TO`. Idempotent: calling twice sends
 * twice — the routine is responsible for calling it once, typically right
 * after the final chunk publishes.
 *
 * Defaults:
 *   - day:       today's NY trading day
 *   - scan_kind: "premarket"
 *
 * Used by the curl-based publish flow (9:45 market-open routine, 10:00
 * analysis routine) to preserve the email feature that publish_dte_research
 * provides for the premarket routine.
 */
const Body = z.object({
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "day must be YYYY-MM-DD")
    .optional(),
  scan_kind: z
    .enum(["premarket", "market_open", "analysis", "settlement"])
    .optional(),
});

export async function POST(req: Request) {
  const auth = requireIngestBearer(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json().catch(() => ({})));
  } catch (err) {
    return NextResponse.json({ error: "bad request", detail: String(err) }, { status: 400 });
  }

  const day = parsed.day || nyTradingDay();
  const scanKind: ScanKind = parsed.scan_kind || "premarket";

  const post = await getPostByDayKind(day, scanKind);
  if (!post) {
    return NextResponse.json(
      { error: `no ${scanKind} post found for ${day}` },
      { status: 404 },
    );
  }

  const trades = (post.trades || []) as Trade[];
  const tickers = trades.map((t) => t.ticker);
  const [bodyHtml, tradesTableHtml] = await Promise.all([
    renderMarkdown(post.bodyMd, tickers),
    Promise.resolve(buildTradesTableHtml(trades)),
  ]);

  try {
    await sendDteResearchEmail({
      title: post.title,
      tradingDay: post.tradingDay,
      runAt: post.runAt,
      sentiment: post.sentiment,
      bias: post.bias,
      bodyHtml,
      tradesTableHtml,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "email send failed", detail: String(err) },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      trading_day: day,
      scan_kind: scanKind,
      title: post.title,
      trades_count: trades.length,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
