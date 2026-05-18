/**
 * Canned event classifier — turns a Finnhub event title into a short,
 * factual description and a list of asset classes it tends to move.
 *
 * Used by the ingest endpoint to populate `description` and `asset_tags`
 * automatically. The richer `impact_text` (regime-aware narrative) is left
 * to the optional Sunday Claude routine.
 *
 * Coverage prioritizes US events + a handful of cross-border movers
 * (ECB, BoJ, BoE, PBoC) that historically push US risk assets.
 */

export interface EventClassification {
  description: string;
  assetTags: string[];
}

interface Pattern {
  /** Case-insensitive match against the event title. */
  match: RegExp;
  classify: (countryUpper: string) => EventClassification;
}

const PATTERNS: Pattern[] = [
  // Fed events ----------------------------------------------------------------
  {
    match: /^(fomc|federal funds rate|fed interest rate|fed.*rate decision)/i,
    classify: () => ({
      description:
        "Federal Open Market Committee rate decision and policy statement. Sets the federal funds target range and signals the path of monetary policy.",
      assetTags: ["SPX", "rates", "USD", "TLT", "VIX", "gold"],
    }),
  },
  {
    match: /(fomc.*minutes|federal reserve.*minutes)/i,
    classify: () => ({
      description:
        "Detailed minutes from the most recent FOMC meeting, three weeks after the decision. Markets parse for nuance on hawkish/dovish dissent and forward guidance.",
      assetTags: ["SPX", "rates", "USD", "TLT"],
    }),
  },
  {
    match: /(powell|fed chair).*(speak|testif)/i,
    classify: () => ({
      description:
        "Public remarks from the Federal Reserve Chair. Off-cycle commentary often moves markets more than scheduled press conferences.",
      assetTags: ["SPX", "rates", "USD", "TLT", "VIX"],
    }),
  },
  {
    match: /\b(powell|fed.*press conference)/i,
    classify: () => ({
      description:
        "Press conference following the FOMC rate decision. Q&A often clarifies the policy statement.",
      assetTags: ["SPX", "rates", "USD", "TLT", "VIX"],
    }),
  },

  // US inflation -------------------------------------------------------------
  {
    match: /^(cpi|consumer price index)/i,
    classify: (c) => ({
      description:
        c === "US"
          ? "US Consumer Price Index — headline + core inflation reading. The single most-watched inflation gauge for Fed policy expectations."
          : "Consumer Price Index for the listed country. Headline + core inflation; informs that central bank's policy path.",
      assetTags: c === "US"
        ? ["SPX", "rates", "USD", "TLT", "gold", "VIX"]
        : ["FX", "rates"],
    }),
  },
  {
    match: /^(ppi|producer price)/i,
    classify: () => ({
      description:
        "Producer Price Index — wholesale inflation. Leading indicator for CPI; markets react when surprises diverge from CPI trend.",
      assetTags: ["SPX", "rates", "USD", "TLT"],
    }),
  },
  {
    match: /(pce|personal consumption)/i,
    classify: () => ({
      description:
        "Personal Consumption Expenditures price index — the Fed's preferred inflation measure. Core PCE matters most for policy.",
      assetTags: ["SPX", "rates", "USD", "TLT", "gold"],
    }),
  },

  // US labor ----------------------------------------------------------------
  {
    match: /(non-?farm.*payroll|nfp|employment situation)/i,
    classify: () => ({
      description:
        "Monthly Employment Situation — non-farm payrolls, unemployment rate, average hourly earnings. The most-watched US economic data after CPI.",
      assetTags: ["SPX", "rates", "USD", "TLT", "VIX"],
    }),
  },
  {
    match: /(initial jobless claims|continuing claims)/i,
    classify: () => ({
      description:
        "Weekly jobless claims data. High-frequency labor-market gauge; the 4-week moving average is the cleaner read.",
      assetTags: ["SPX", "rates", "USD"],
    }),
  },
  {
    match: /(jolts|job openings)/i,
    classify: () => ({
      description:
        "Job Openings and Labor Turnover Survey. Quits rate and openings/unemployed ratio are key gauges of labor market tightness.",
      assetTags: ["SPX", "rates", "USD"],
    }),
  },
  {
    match: /\bADP\b/i,
    classify: () => ({
      description:
        "ADP private-sector payrolls report. Released Wednesday before NFP; correlation with NFP is loose, so reaction is moderate unless it's a big miss.",
      assetTags: ["SPX", "rates", "USD"],
    }),
  },

  // US growth ---------------------------------------------------------------
  {
    match: /^(gdp|gross domestic product)/i,
    classify: (c) => ({
      description:
        c === "US"
          ? "GDP growth print — quarterly. Advance is the first read; preliminary and final revise as more data comes in."
          : "Quarterly GDP for the listed country. Material when it surprises consensus or signals recession risk.",
      assetTags: c === "US" ? ["SPX", "rates", "USD"] : ["FX"],
    }),
  },
  {
    match: /(retail sales|advance retail)/i,
    classify: () => ({
      description:
        "Monthly retail sales — broadest read on consumer spending. Control-group ex-autos/gas/building is the cleanest signal.",
      assetTags: ["SPX", "consumer", "USD"],
    }),
  },
  {
    match: /(ism manufacturing|manufacturing pmi)/i,
    classify: () => ({
      description:
        "Manufacturing Purchasing Managers' Index. Above 50 = expansion; new orders sub-index is the leading edge.",
      assetTags: ["SPX", "industrials", "USD"],
    }),
  },
  {
    match: /(ism services|services pmi|non-?manufacturing pmi)/i,
    classify: () => ({
      description:
        "Services Purchasing Managers' Index. Services account for ~70% of US GDP; a print under 50 raises recession-watch.",
      assetTags: ["SPX", "USD"],
    }),
  },
  {
    match: /(consumer confidence|consumer sentiment|michigan)/i,
    classify: () => ({
      description:
        "Consumer sentiment survey. Inflation expectations sub-component is more market-moving than the headline.",
      assetTags: ["SPX", "consumer", "rates"],
    }),
  },

  // Foreign central banks ----------------------------------------------------
  {
    match: /(ecb|european central bank).*(rate|decision|press)/i,
    classify: () => ({
      description:
        "European Central Bank rate decision. Cross-asset moves through the EUR/USD channel and into US rate expectations.",
      assetTags: ["EUR", "DXY", "rates", "SPX"],
    }),
  },
  {
    match: /(boj|bank of japan).*(rate|decision)/i,
    classify: () => ({
      description:
        "Bank of Japan policy decision. Surprises (rare) move USD/JPY hard, with knock-on effects on US Treasuries through carry-trade unwinds.",
      assetTags: ["JPY", "USD", "TLT"],
    }),
  },
  {
    match: /(boe|bank of england).*(rate|decision)/i,
    classify: () => ({
      description:
        "Bank of England policy decision. Primarily moves GBP and Gilts; spillover to US is modest unless tied to BoE/Fed divergence narrative.",
      assetTags: ["GBP", "DXY"],
    }),
  },
  {
    match: /(pboc|china.*rate|china.*lpr|loan prime rate)/i,
    classify: () => ({
      description:
        "People's Bank of China rate decision. Rate cuts often boost commodities and US-listed China-exposed names; little direct US rate impact.",
      assetTags: ["copper", "oil", "FXI", "commodities"],
    }),
  },

  // Energy/commodities -----------------------------------------------------
  {
    match: /(crude oil inventories|eia.*petroleum)/i,
    classify: () => ({
      description:
        "EIA weekly crude inventory report. Surprises move WTI directly; energy-equity sensitivity is high.",
      assetTags: ["oil", "XLE", "USD"],
    }),
  },
  {
    match: /(natural gas|eia.*natural)/i,
    classify: () => ({
      description:
        "EIA weekly natural gas storage report. Most relevant in heating/cooling season; otherwise modest.",
      assetTags: ["natgas"],
    }),
  },

  // Treasury auctions ------------------------------------------------------
  {
    match: /(treasury auction|note auction|bond auction|bill auction)/i,
    classify: () => ({
      description:
        "US Treasury auction. Bid-to-cover and indirect bidder share signal demand; weak auctions push yields up across the curve.",
      assetTags: ["rates", "TLT", "USD"],
    }),
  },
];

const FALLBACK: EventClassification = {
  description: "",
  assetTags: [],
};

/**
 * Classify a Finnhub event title. Returns canned description + asset tags
 * when a known pattern matches; an empty fallback otherwise (callers can
 * leave description NULL and let the Claude routine fill it in later).
 */
export function classifyEconEvent(
  title: string,
  country: string,
): EventClassification {
  const c = country.toUpperCase();
  for (const p of PATTERNS) {
    if (p.match.test(title)) return p.classify(c);
  }
  return FALLBACK;
}
