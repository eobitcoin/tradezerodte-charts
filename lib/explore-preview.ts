/**
 * Server-side preview loaders for /explore/* pages.
 *
 * SECURITY MODEL
 * --------------
 * Each loader does a narrow SELECT against the authenticated post tables and
 * RE-SHAPES the data into a `{ headline, hiddenCount }` pattern:
 *
 *   - `headline` — the single chosen item that gets full reveal (full thesis,
 *     full metrics). Always the most compelling pick for the scan.
 *   - `hiddenCount` — a count of remaining items. NO identifying data
 *     (ticker, sector, company name, etc.) leaves the trust boundary for
 *     non-headline items. The view renders N generic blurred placeholders.
 *
 * This eliminates the previous leak where non-headline ticker / sector chips
 * appeared in page HTML. View source on a preview page now contains ONLY:
 *   - title, summary (curated, public-by-design)
 *   - the single headline item (intentional full reveal)
 *   - a number indicating how many more items are members-only
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  institutionalPosts,
  earningsPosts,
  sectorRotationPosts,
  insiderPosts,
  posts,
  researchPosts,
  type ResearchPost,
} from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Institutional Flow preview
// ---------------------------------------------------------------------------

export interface InstitutionalHeadline {
  ticker: string;
  companyName: string;
  sector: string | null;
  marketCapUsdB: number | null;
  thesis: string;
  totalSharesHeld: number | null;
  totalSharesHeldUsd: number | null;
  supportingFundsCount: number;
}

export interface InstitutionalPreview {
  scanDay: string;
  runAt: Date | null;
  summary: string;
  stockCount: number;
  hiddenCount: number;
  headline: InstitutionalHeadline | null;
}

export async function loadInstitutionalPreview(
  scanDay?: string,
): Promise<InstitutionalPreview | null> {
  const [row] = await db
    .select({
      scanDay: institutionalPosts.scanDay,
      runAt: institutionalPosts.runAt,
      summary: institutionalPosts.summary,
      stocks: institutionalPosts.stocks,
    })
    .from(institutionalPosts)
    .where(scanDay ? eq(institutionalPosts.scanDay, scanDay) : undefined)
    .orderBy(desc(institutionalPosts.scanDay))
    .limit(1);
  if (!row) return null;

  const fullStocks = Array.isArray(row.stocks) ? row.stocks : [];
  const first = fullStocks[0] ?? null;
  const headline: InstitutionalHeadline | null = first
    ? {
        ticker: first.ticker,
        companyName: first.companyName,
        sector: first.sector ?? null,
        marketCapUsdB: first.marketCapUsdB ?? null,
        thesis: first.thesis,
        totalSharesHeld: first.totalSharesHeld ?? null,
        totalSharesHeldUsd: first.totalSharesHeldUsd ?? null,
        supportingFundsCount: Array.isArray(first.supportingFunds)
          ? first.supportingFunds.length
          : 0,
      }
    : null;

  return {
    scanDay: row.scanDay,
    runAt: row.runAt,
    summary: row.summary,
    stockCount: fullStocks.length,
    hiddenCount: Math.max(0, fullStocks.length - (first ? 1 : 0)),
    headline,
  };
}

export async function listInstitutionalScanDays(limit = 60): Promise<string[]> {
  const rows = await db
    .select({ scanDay: institutionalPosts.scanDay })
    .from(institutionalPosts)
    .orderBy(desc(institutionalPosts.scanDay))
    .limit(limit);
  return rows.map((r) => r.scanDay);
}

// ---------------------------------------------------------------------------
// Earnings Whiplash preview
// ---------------------------------------------------------------------------

export interface EarningsHeadline {
  ticker: string;
  companyName: string;
  sector: string | null;
  earningsDate: string;
  earningsTime: "bmo" | "amc" | "unknown";
  isFlagged: boolean;
  thesis: string;
  impliedMovePct: number | null;
  historicalAvgMovePct: number | null;
  ivVsHvDeltaPct: number | null;
  flagReason: string | null;
}

export interface EarningsPreview {
  scanDay: string;
  runAt: Date | null;
  summary: string;
  stockCount: number;
  flaggedCount: number;
  hiddenCount: number;
  headline: EarningsHeadline | null;
}

export async function loadEarningsPreview(scanDay?: string): Promise<EarningsPreview | null> {
  const [row] = await db
    .select({
      scanDay: earningsPosts.scanDay,
      runAt: earningsPosts.runAt,
      summary: earningsPosts.summary,
      stocks: earningsPosts.stocks,
    })
    .from(earningsPosts)
    .where(scanDay ? eq(earningsPosts.scanDay, scanDay) : undefined)
    .orderBy(desc(earningsPosts.scanDay))
    .limit(1);
  if (!row) return null;

  const fullStocks = Array.isArray(row.stocks) ? row.stocks : [];
  // Headline = first flagged stock if any, otherwise first stock.
  const flaggedIdx = fullStocks.findIndex((s) => s.isFlagged);
  const first = flaggedIdx >= 0 ? fullStocks[flaggedIdx] : fullStocks[0] ?? null;
  const headline: EarningsHeadline | null = first
    ? {
        ticker: first.ticker,
        companyName: first.companyName,
        sector: first.sector ?? null,
        earningsDate: first.earningsDate,
        earningsTime: first.earningsTime,
        isFlagged: first.isFlagged,
        thesis: first.thesis,
        impliedMovePct: first.impliedMovePct ?? null,
        historicalAvgMovePct: first.historicalAvgMovePct ?? null,
        ivVsHvDeltaPct: first.ivVsHvDeltaPct ?? null,
        flagReason: first.flagReason,
      }
    : null;

  return {
    scanDay: row.scanDay,
    runAt: row.runAt,
    summary: row.summary,
    stockCount: fullStocks.length,
    flaggedCount: fullStocks.filter((s) => s.isFlagged).length,
    hiddenCount: Math.max(0, fullStocks.length - (first ? 1 : 0)),
    headline,
  };
}

export async function listEarningsScanDays(limit = 60): Promise<string[]> {
  const rows = await db
    .select({ scanDay: earningsPosts.scanDay })
    .from(earningsPosts)
    .orderBy(desc(earningsPosts.scanDay))
    .limit(limit);
  return rows.map((r) => r.scanDay);
}

// ---------------------------------------------------------------------------
// Sector Rotation preview
// ---------------------------------------------------------------------------

export interface SectorRotationHeadline {
  sectorName: string;
  sectorEtf: string;
  rotationDirection: string;
  isRotating: boolean;
  thesis: string;
  relativeStrength: number | null;
  relativeStrengthPriorYear: number | null;
  topEtfTicker: string | null;
}

export interface SectorRotationPreview {
  scanDay: string;
  runAt: Date | null;
  summary: string;
  sectorCount: number;
  rotatingCount: number;
  hiddenCount: number;
  headline: SectorRotationHeadline | null;
}

export async function loadSectorRotationPreview(
  scanDay?: string,
): Promise<SectorRotationPreview | null> {
  const [row] = await db
    .select({
      scanDay: sectorRotationPosts.scanDay,
      runAt: sectorRotationPosts.runAt,
      summary: sectorRotationPosts.summary,
      sectors: sectorRotationPosts.sectors,
    })
    .from(sectorRotationPosts)
    .where(scanDay ? eq(sectorRotationPosts.scanDay, scanDay) : undefined)
    .orderBy(desc(sectorRotationPosts.scanDay))
    .limit(1);
  if (!row) return null;

  const fullSectors = Array.isArray(row.sectors) ? row.sectors : [];
  const rotatingIdx = fullSectors.findIndex((s) => s.isRotating);
  const first = rotatingIdx >= 0 ? fullSectors[rotatingIdx] : fullSectors[0] ?? null;
  const headline: SectorRotationHeadline | null = first
    ? {
        sectorName: first.sectorName,
        sectorEtf: first.sectorEtf,
        rotationDirection: first.rotationDirection,
        isRotating: first.isRotating,
        thesis: first.thesis,
        relativeStrength: first.relativeStrength ?? null,
        relativeStrengthPriorYear: first.relativeStrengthPriorYear ?? null,
        topEtfTicker:
          Array.isArray(first.topEtfs) && first.topEtfs.length > 0
            ? first.topEtfs[0].ticker
            : null,
      }
    : null;

  return {
    scanDay: row.scanDay,
    runAt: row.runAt,
    summary: row.summary,
    sectorCount: fullSectors.length,
    rotatingCount: fullSectors.filter((s) => s.isRotating).length,
    hiddenCount: Math.max(0, fullSectors.length - (first ? 1 : 0)),
    headline,
  };
}

export async function listSectorRotationScanDays(limit = 60): Promise<string[]> {
  const rows = await db
    .select({ scanDay: sectorRotationPosts.scanDay })
    .from(sectorRotationPosts)
    .orderBy(desc(sectorRotationPosts.scanDay))
    .limit(limit);
  return rows.map((r) => r.scanDay);
}

// ---------------------------------------------------------------------------
// Insider preview
// ---------------------------------------------------------------------------

export interface InsiderHeadline {
  ticker: string;
  insiderName: string | null;
  position: string | null;
  totalValueUsd: number | null;
  shares: number | null;
  filingDate: string | null;
}

export interface InsiderPreview {
  scanDay: string;
  runAt: Date | null;
  title: string;
  buyCount: number;
  hiddenCount: number;
  headline: InsiderHeadline | null;
}

export async function loadInsiderPreview(scanDay?: string): Promise<InsiderPreview | null> {
  const [row] = await db
    .select({
      scanDay: insiderPosts.scanDay,
      runAt: insiderPosts.runAt,
      title: insiderPosts.title,
      buys: insiderPosts.buys,
    })
    .from(insiderPosts)
    .where(scanDay ? eq(insiderPosts.scanDay, scanDay) : undefined)
    .orderBy(desc(insiderPosts.scanDay))
    .limit(1);
  if (!row) return null;

  const allBuys = Array.isArray(row.buys) ? row.buys : [];
  const sorted = [...allBuys].sort(
    (a, b) => (b.total_value ?? 0) - (a.total_value ?? 0),
  );
  const first = sorted[0] ?? null;
  const headline: InsiderHeadline | null = first
    ? {
        ticker: first.ticker,
        insiderName: first.executive ?? null,
        position: first.title ?? null,
        totalValueUsd: first.total_value ?? null,
        shares: first.shares ?? null,
        filingDate: first.filing_date ?? null,
      }
    : null;

  return {
    scanDay: row.scanDay,
    runAt: row.runAt,
    title: row.title,
    buyCount: allBuys.length,
    hiddenCount: Math.max(0, allBuys.length - (first ? 1 : 0)),
    headline,
  };
}

export async function listInsiderScanDays(limit = 60): Promise<string[]> {
  const rows = await db
    .select({ scanDay: insiderPosts.scanDay })
    .from(insiderPosts)
    .orderBy(desc(insiderPosts.scanDay))
    .limit(limit);
  return rows.map((r) => r.scanDay);
}

// ---------------------------------------------------------------------------
// Daily Analysis preview (hybrid model: premarket trade plan + market_open
// revisions + post-close analysis outcomes folded into one card)
// ---------------------------------------------------------------------------

import { mergeDayScans, type MergedTrade } from "@/lib/merge-trades";

export interface DailyAnalysisPreview {
  tradingDay: string;
  runAt: Date | null;
  title: string;
  sentiment: string | null;
  bias: string | null;
  tradeCount: number;
  hiddenCount: number;
  /** The single fully-revealed trade. Already includes any market_open
   *  revisions and any analysis outcome overlay for that ticker. */
  headlineTrade: MergedTrade | null;
  /** Which later scans contributed to the merge — used by the view to show
   *  badges like "Updated at market open" on the page header. */
  hasMarketOpen: boolean;
  hasAnalysis: boolean;
}

export async function loadDailyAnalysisPreview(
  tradingDay?: string,
): Promise<DailyAnalysisPreview | null> {
  // Find the trading day we'll render — most recent premarket post, or the
  // explicit day if specified. The headline trade is still anchored to the
  // premarket scan; market_open/analysis only overlay it.
  const [premarketRow] = await db
    .select()
    .from(posts)
    .where(
      tradingDay
        ? and(eq(posts.scanKind, "premarket"), eq(posts.tradingDay, tradingDay))
        : eq(posts.scanKind, "premarket"),
    )
    .orderBy(desc(posts.tradingDay))
    .limit(1);
  if (!premarketRow) return null;

  const sameDayRows = await db
    .select()
    .from(posts)
    .where(eq(posts.tradingDay, premarketRow.tradingDay));
  const marketOpenRow =
    sameDayRows.find((r) => r.scanKind === "market_open") ?? null;
  const analysisRow = sameDayRows.find((r) => r.scanKind === "analysis") ?? null;
  const settlementRow =
    sameDayRows.find((r) => r.scanKind === "settlement") ?? null;

  const { trades, hasMarketOpen, hasAnalysis } = mergeDayScans({
    premarket: premarketRow,
    marketOpen: marketOpenRow,
    analysis: analysisRow,
    settlement: settlementRow,
  });

  // Headline = top-ranked non-killed trade (already sorted by rank in merge).
  const headlineTrade = trades.find((t) => t.status !== "killed") ?? null;
  const tradeCount = trades.length;
  const hiddenCount = Math.max(0, tradeCount - (headlineTrade ? 1 : 0));

  return {
    tradingDay: premarketRow.tradingDay,
    runAt: premarketRow.runAt,
    title: premarketRow.title,
    sentiment: premarketRow.sentiment,
    bias: premarketRow.bias,
    tradeCount,
    hiddenCount,
    headlineTrade,
    hasMarketOpen,
    hasAnalysis,
  };
}

export async function listDailyAnalysisTradingDays(limit = 60): Promise<string[]> {
  const rows = await db
    .select({ tradingDay: posts.tradingDay })
    .from(posts)
    .where(eq(posts.scanKind, "premarket"))
    .orderBy(desc(posts.tradingDay))
    .limit(limit);
  return rows.map((r) => r.tradingDay);
}

// ---------------------------------------------------------------------------
// Metals Research preview
//
// Differs from the other previews above: research_posts stores one ticker
// per row, not a JSONB array of items in a single row. So the "preview"
// fully reveals ONE metals post (the alphabetically-first ticker for the
// given scan_day, deterministic), and reports the count of other tickers
// covered that day for the BlurredCard placeholders.
// ---------------------------------------------------------------------------

export interface MetalsPreview {
  scanDay: string;
  runAt: Date | null;
  /** The fully-revealed headline post. */
  headline: ResearchPost | null;
  /** Number of other metals tickers covered on the same scan_day (for the
   *  members-only blurred placeholder cards). */
  hiddenCount: number;
  /** All tickers covered on this scan day, used only for the rendered
   *  count and the BlurredCard list — the placeholder cards don't show
   *  the ticker symbol so no metadata leaks. */
  totalTickerCount: number;
}

export async function loadMetalsPreview(
  scanDay?: string,
): Promise<MetalsPreview | null> {
  // Pick the target scan_day: either the explicit one or the most recent
  // day that has any metals post at all.
  let day = scanDay;
  if (!day) {
    const [latest] = await db
      .select({ scanDay: researchPosts.scanDay })
      .from(researchPosts)
      .where(eq(researchPosts.assetClass, "metals"))
      .orderBy(desc(researchPosts.scanDay))
      .limit(1);
    if (!latest) return null;
    day = latest.scanDay;
  }
  // Pull every metals post on the chosen day. Headline = first by ticker
  // alpha (deterministic — same headline every render until new data lands).
  const rows = await db
    .select()
    .from(researchPosts)
    .where(
      and(
        eq(researchPosts.assetClass, "metals"),
        eq(researchPosts.scanDay, day),
      ),
    )
    .orderBy(researchPosts.ticker);
  if (rows.length === 0) return null;
  const headline = rows[0];
  return {
    scanDay: day,
    runAt: headline.runAt ?? headline.createdAt,
    headline,
    hiddenCount: Math.max(0, rows.length - 1),
    totalTickerCount: rows.length,
  };
}

export async function listMetalsScanDays(limit = 26): Promise<string[]> {
  // Distinct scan_days that have at least one metals post, newest-first.
  // `selectDistinctOn` requires the ORDER BY to start with the distinct
  // column, which can still be DESC — gives us the latest N scan days.
  const rows = await db
    .selectDistinctOn([researchPosts.scanDay], { scanDay: researchPosts.scanDay })
    .from(researchPosts)
    .where(eq(researchPosts.assetClass, "metals"))
    .orderBy(desc(researchPosts.scanDay))
    .limit(limit);
  return rows.map((r) => r.scanDay);
}
