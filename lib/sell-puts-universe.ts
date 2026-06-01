/**
 * Locked Sell Puts scan universe.
 *
 * Curated list of ~50 large/mega-cap US equities + 3 index ETFs. All
 * names selected for:
 *   - Active weekly + monthly options chains
 *   - Tight bid-ask spreads on OTM puts
 *   - Stock price > $30 (so 21-45 DTE puts have meaningful premium)
 *   - Diversified sectors (no concentration risk)
 *
 * Black-Scholes-derived probabilities work cleanly on these — none of
 * the chain is dominated by meme-stock vol smiles or 0DTE pin risk.
 *
 * Expand by adding tickers below. The scanner walks them all every
 * Sunday; runtime scales linearly (~3 sec per ticker on the Polygon
 * snapshot endpoint).
 */
export const SELL_PUTS_UNIVERSE: ReadonlyArray<string> = [
  // Mega-cap tech
  "AAPL", "MSFT", "GOOGL", "META", "AMZN", "NVDA", "TSLA", "AVGO", "ORCL",
  "ADBE", "CRM", "NFLX",

  // Semis
  "AMD", "INTC", "MU", "QCOM", "TSM", "TXN", "ASML",

  // Financials
  "JPM", "BAC", "GS", "MS", "SCHW", "WFC", "BLK", "V", "MA",

  // Healthcare / pharma
  "UNH", "LLY", "JNJ", "PFE", "ABBV", "MRK", "TMO", "DHR",

  // Consumer / retail
  "HD", "LOW", "MCD", "SBUX", "NKE", "COST", "WMT", "TGT", "DIS",

  // Industrials / defense
  "CAT", "BA", "GE", "HON", "LMT", "RTX",

  // Energy
  "XOM", "CVX",

  // Telecom
  "T", "VZ",

  // Index ETFs
  "SPY", "QQQ", "IWM",
] as const;

/** Sanity check used by the cron — exposed for testing. */
export function universeSize(): number {
  return SELL_PUTS_UNIVERSE.length;
}
