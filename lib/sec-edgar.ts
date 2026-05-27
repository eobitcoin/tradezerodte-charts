/**
 * SEC EDGAR fundamentals fetcher.
 *
 * Pulls XBRL company-facts data from SEC's public API and normalises it
 * into a single shape the quantum research routine (and any future
 * fundamental-research routine) can consume directly. Free + official —
 * no API key, no rate limits beyond SEC's 10 req/sec policy.
 *
 * Key gotcha: XBRL tags vary by company + reporting era. Modern issuers
 * use ASC 606 tags like `RevenueFromContractWithCustomerExcludingAssessedTax`;
 * older / non-standard issuers use the legacy `Revenues` or `SalesRevenueNet`
 * tag. We try a priority-ordered list of tag names and take the first
 * that's populated for the quarter we want.
 *
 * Required: SEC mandates a descriptive User-Agent header. Setting it
 * here so callers don't have to think about it.
 */

const SEC_USER_AGENT =
  "Olivia Trades Research research@oliviatrades.com";

const COMPANYFACTS_URL = (cik10: string) =>
  `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik10}.json`;

/** Pad a CIK to 10 digits (SEC's API requires zero-padded form). */
function padCik(cik: number | string): string {
  return String(cik).replace(/^CIK/i, "").padStart(10, "0");
}

/** Hardcoded ticker → CIK map for the quantum watchlist plus a few
 *  obvious equity adjacencies. Sized so we don't need to fetch SEC's
 *  global lookup file for the common case. Falls back to a remote
 *  lookup for anything else via `resolveCikForTicker`. */
const HARDCODED_CIK: Record<string, string> = {
  // Quantum watchlist (final 6 — all US-listed, all in SEC EDGAR).
  IONQ: "1824920",  // trapped-ion
  RGTI: "1838359",  // superconducting
  QBTS: "1907982",  // D-Wave (annealing)
  QUBT: "1758009",  // Quantum Computing Inc (photonic)
  INFQ: "2007825",  // Infleqtion (neutral atom; recent SPAC merger)
  FORM: "1039399",  // FormFactor (picks-and-shovels — cryogenic test for QC labs)
  // Common equities we may reference for valuation comparison.
  GOOGL: "1652044",
  MSFT: "789019",
  IBM: "51143",
  NVDA: "1045810",
};

/** Cache for SEC's master ticker→CIK file. Refreshed once per process. */
let tickerLookupCache: Record<string, string> | null = null;

async function resolveCikForTicker(ticker: string): Promise<string | null> {
  const t = ticker.toUpperCase();
  if (HARDCODED_CIK[t]) return padCik(HARDCODED_CIK[t]);
  if (tickerLookupCache) {
    return tickerLookupCache[t] ? padCik(tickerLookupCache[t]) : null;
  }
  try {
    const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
      headers: { "User-Agent": SEC_USER_AGENT, Accept: "application/json" },
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<
      string,
      { cik_str: number; ticker: string; title: string }
    >;
    const map: Record<string, string> = {};
    for (const v of Object.values(data)) {
      map[v.ticker.toUpperCase()] = String(v.cik_str);
    }
    tickerLookupCache = map;
    return map[t] ? padCik(map[t]) : null;
  } catch {
    return null;
  }
}

/** XBRL fact slice — one observation. */
interface XbrlFact {
  start?: string;
  end: string;
  val: number;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
  frame?: string;
  /** Accession number of the filing this fact came from. */
  accn?: string;
}

/** Drill into companyfacts.facts.us-gaap[tag].units.* and return the
 *  first non-empty unit array. Different facts use different unit keys —
 *  USD for monetary, "shares" for share counts, "USD/shares" for per-share. */
function factsForTag(facts: Record<string, unknown>, tag: string): XbrlFact[] {
  const node = facts[tag] as
    | { units?: Record<string, XbrlFact[]> }
    | undefined;
  if (!node?.units) return [];
  for (const unitKey of ["USD", "shares", "USD/shares", "pure"]) {
    const arr = node.units[unitKey];
    if (arr && arr.length > 0) return arr;
  }
  // Last resort: pick whatever's there.
  const first = Object.values(node.units)[0];
  return first ?? [];
}

/** Try a list of candidate tag names; return the first that yields any data. */
function firstPopulatedTag(
  facts: Record<string, unknown>,
  tags: string[],
): XbrlFact[] {
  for (const tag of tags) {
    const f = factsForTag(facts, tag);
    if (f.length > 0) return f;
  }
  return [];
}

/** Merge ALL fallback-tag candidates into one fact array. Useful for
 *  balance-sheet metrics like cash where different companies report
 *  under different tags but you want the latest observation across any
 *  of them — not just the first tag that has data. */
function mergedTagFacts(
  facts: Record<string, unknown>,
  tags: string[],
): XbrlFact[] {
  const merged: XbrlFact[] = [];
  for (const tag of tags) {
    merged.push(...factsForTag(facts, tag));
  }
  return merged;
}

/** Latest fact under a tag — picks the row with the most recent `end` date. */
function latestFact(facts: XbrlFact[]): XbrlFact | null {
  if (!facts.length) return null;
  return facts.reduce((latest, cur) =>
    cur.end > latest.end ? cur : latest,
  );
}

/** Trailing-12-month sum: take the four most recent unique-by-end-date
 *  quarterly facts and add. Dedupes on `end` (same quarter can appear
 *  in multiple amendment filings — pick the latest). */
function trailingTwelveMonths(facts: XbrlFact[]): {
  value: number | null;
  quartersUsed: string[];
} {
  const quarterly = facts
    .filter(
      (f) =>
        (f.fp === "Q1" || f.fp === "Q2" || f.fp === "Q3" || f.fp === "Q4") &&
        f.start &&
        f.end &&
        // Quarter facts should span ~3 months, not full year.
        new Date(f.end).getTime() - new Date(f.start).getTime() <
          120 * 24 * 3600 * 1000,
    )
    .sort((a, b) => (a.end < b.end ? 1 : -1));
  // Dedupe by `end` BEFORE slicing — same quarter can appear in multiple
  // filings (original + amendment). Take the one filed most recently per end.
  const byEnd = new Map<string, XbrlFact>();
  for (const q of quarterly) {
    const existing = byEnd.get(q.end);
    if (!existing || (q.filed ?? "") > (existing.filed ?? "")) {
      byEnd.set(q.end, q);
    }
  }
  const unique = [...byEnd.values()].sort((a, b) => (a.end < b.end ? 1 : -1));
  if (unique.length >= 4) {
    const last4 = unique.slice(0, 4);
    return {
      value: last4.reduce((s, q) => s + q.val, 0),
      // Label by end-date so we don't show "2026-Q1" twice for different years.
      quartersUsed: last4.map((q) => q.end),
    };
  }
  // Fall back to latest FY value if quarterlies aren't there.
  const fy = facts
    .filter((f) => f.fp === "FY" && f.start && f.end)
    .sort((a, b) => (a.end < b.end ? 1 : -1))[0];
  return fy
    ? { value: fy.val, quartersUsed: [`${fy.end} (FY)`] }
    : { value: null, quartersUsed: [] };
}

export interface SecFundamentals {
  ticker: string;
  cik: string;
  companyName: string | null;
  asOf: string | null;
  /** Revenue trailing 12 months (in USD). */
  revenueTtm: number | null;
  revenueTtmDetail: string[];
  /** Revenue YoY growth %. */
  revenueYoyPct: number | null;
  /** Gross margin % (gross profit / revenue). */
  grossMarginPct: number | null;
  /** Operating income TTM (negative for unprofitable). */
  operatingIncomeTtm: number | null;
  /** Cash + short-term investments at latest balance-sheet date. */
  cashAndSt: number | null;
  /** Most recent quarter's cash used in operations (negative = burning). */
  quarterlyCashFromOps: number | null;
  /** Runway in quarters: cashAndSt / abs(quarterlyCashFromOps). null if not burning. */
  runwayQuarters: number | null;
  /** Diluted shares outstanding (most recent). */
  sharesOutstanding: number | null;
  /** SEC filing this came from (URL on edgar). */
  latestFilingForm: string | null;
  latestFilingAccessionNumber: string | null;
  latestFilingUrl: string | null;
}

/** Stable accessor: given a numeric `accn`, build the filing-index URL. */
function filingUrl(cik: string, accn: string | undefined): string | null {
  if (!accn) return null;
  const cikInt = parseInt(cik, 10);
  const accnNoDash = accn.replace(/-/g, "");
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cikInt}&type=10-Q&dateb=&owner=include&count=10&action=getcompany`;
}

/**
 * Pull a single ticker's fundamentals from SEC EDGAR. Returns null if
 * the company can't be found (no CIK, network error, etc.) — caller
 * decides how to handle.
 */
export async function fetchSecFundamentals(
  ticker: string,
): Promise<SecFundamentals | null> {
  const t = ticker.toUpperCase();
  const cik = await resolveCikForTicker(t);
  if (!cik) return null;

  const res = await fetch(COMPANYFACTS_URL(cik), {
    headers: { "User-Agent": SEC_USER_AGENT, Accept: "application/json" },
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    return null;
  }
  const json = (await res.json()) as {
    cik?: number;
    entityName?: string;
    facts?: { "us-gaap"?: Record<string, unknown> };
  };
  const facts = json.facts?.["us-gaap"] ?? {};

  // Revenue TTM — try modern ASC 606 tag first, then legacy fallbacks.
  const revenueFacts = firstPopulatedTag(facts, [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
    "SalesRevenueGoodsNet",
  ]);
  const revenueTtm = trailingTwelveMonths(revenueFacts);

  // Revenue YoY: compute from TTM-now vs TTM-1-year-ago (if 8+ quarters available).
  let revenueYoyPct: number | null = null;
  const quarterly = revenueFacts.filter(
    (f) => f.fp && /^Q[1-4]$/.test(f.fp),
  );
  // Find latest 8 unique-by-end quarters
  const seenEnds = new Set<string>();
  const q8 = quarterly
    .sort((a, b) => (a.end < b.end ? 1 : -1))
    .filter((f) => {
      if (seenEnds.has(f.end)) return false;
      seenEnds.add(f.end);
      return true;
    })
    .slice(0, 8);
  if (q8.length === 8) {
    const ttmNow = q8.slice(0, 4).reduce((s, q) => s + q.val, 0);
    const ttmPrior = q8.slice(4, 8).reduce((s, q) => s + q.val, 0);
    if (ttmPrior > 0) {
      revenueYoyPct = ((ttmNow - ttmPrior) / ttmPrior) * 100;
    }
  }

  // Gross profit / margin. Most issuers report `GrossProfit` directly,
  // but quantum / early-stage cos often only report `CostOfRevenue` (or
  // a long-form cost tag) and the reader infers gross profit. Try the
  // direct tag first, then compute revenue - cost when only cost is tagged.
  const grossFacts = firstPopulatedTag(facts, [
    "GrossProfit",
    "GrossProfitLoss",
  ]);
  let grossTtmValue: number | null = trailingTwelveMonths(grossFacts).value;
  if (grossTtmValue == null && revenueTtm.value != null) {
    const costFacts = firstPopulatedTag(facts, [
      "CostOfRevenue",
      "CostOfGoodsAndServicesSold",
      "CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization",
      "CostOfServices",
    ]);
    const costTtm = trailingTwelveMonths(costFacts).value;
    if (costTtm != null) {
      grossTtmValue = revenueTtm.value - costTtm;
    }
  }
  const grossMarginPct =
    grossTtmValue != null && revenueTtm.value && revenueTtm.value > 0
      ? (grossTtmValue / revenueTtm.value) * 100
      : null;

  // Operating income TTM.
  const opIncFacts = firstPopulatedTag(facts, [
    "OperatingIncomeLoss",
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
  ]);
  const opIncTtm = trailingTwelveMonths(opIncFacts);

  // Cash + short-term investments. MERGE across all fallback tags and
  // pick the most recent observation, because different filings often
  // report under different tags (legacy "Cash" pre-2018 vs modern
  // "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"
  // post-2018 — RGTI is a known example).
  const cashFacts = mergedTagFacts(facts, [
    "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    "CashAndCashEquivalentsAtCarryingValue",
    "Cash",
  ]);
  const stInvestFacts = mergedTagFacts(facts, [
    "ShortTermInvestments",
    "AvailableForSaleSecuritiesCurrent",
    "MarketableSecuritiesCurrent",
  ]);
  const cashLatest = latestFact(cashFacts);
  const stInvestLatest = latestFact(stInvestFacts);
  const cashAndSt =
    cashLatest && stInvestLatest && stInvestLatest.end === cashLatest.end
      ? cashLatest.val + stInvestLatest.val
      : cashLatest?.val ?? null;

  // Quarterly cash from ops — most recent Q only (negative when burning).
  const cashOpsFacts = firstPopulatedTag(facts, [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
  ]);
  const cashOpsQuarterly = cashOpsFacts
    .filter((f) => f.fp && /^Q[1-4]$/.test(f.fp))
    .sort((a, b) => (a.end < b.end ? 1 : -1));
  const quarterlyCashFromOps = cashOpsQuarterly[0]?.val ?? null;
  const runwayQuarters =
    cashAndSt &&
    quarterlyCashFromOps != null &&
    quarterlyCashFromOps < 0
      ? cashAndSt / Math.abs(quarterlyCashFromOps)
      : null;

  // Shares outstanding (latest). Common tag has unit="shares" not "USD",
  // which the updated factsForTag handles. Diluted weighted-average is
  // a fallback when a point-in-time tag isn't published.
  const sharesFacts = mergedTagFacts(facts, [
    "CommonStockSharesOutstanding",
    "EntityCommonStockSharesOutstanding",
    "WeightedAverageNumberOfDilutedSharesOutstanding",
    "WeightedAverageNumberOfSharesOutstandingBasic",
  ]);
  const sharesLatest = latestFact(sharesFacts);

  // Latest filing form — use the most recent revenue fact's `form` + `accn`.
  const newest = latestFact([
    ...revenueFacts,
    ...cashFacts,
    ...opIncFacts,
  ]);

  return {
    ticker: t,
    cik,
    companyName: json.entityName ?? null,
    asOf: cashLatest?.end ?? newest?.end ?? null,
    revenueTtm: revenueTtm.value,
    revenueTtmDetail: revenueTtm.quartersUsed,
    revenueYoyPct,
    grossMarginPct,
    operatingIncomeTtm: opIncTtm.value,
    cashAndSt,
    quarterlyCashFromOps,
    runwayQuarters,
    sharesOutstanding: sharesLatest?.val ?? null,
    latestFilingForm: newest?.form ?? null,
    latestFilingAccessionNumber: newest?.accn ?? null,
    latestFilingUrl: filingUrl(cik, newest?.accn),
  };
}
