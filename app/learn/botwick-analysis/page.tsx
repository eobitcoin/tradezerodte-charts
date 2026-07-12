import type { Metadata } from "next";
import LearnPageScaffold from "@/components/LearnPageScaffold";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

export const metadata: Metadata = {
  title: "Reading BotWick Analysis — Daily Smart-Money Technical Reports",
  description:
    "Every weekday at 6:00 AM ET, BotWick Analysis publishes a full Smart-Money-Concepts technical report for 21 core names (AAPL, NVDA, TSLA, SPY, QQQ and more): a 10-indicator scorecard, swing/equilibrium levels, support & resistance ladders, supply/demand imbalances, long and short trade scenarios with entries, targets and stops, and a defined-risk options idea. Here's how to read every section.",
  alternates: { canonical: `${APP_URL}/learn/botwick-analysis` },
  openGraph: {
    type: "article",
    url: `${APP_URL}/learn/botwick-analysis`,
    title: "Reading BotWick Analysis — Daily Smart-Money Technical Reports",
    description:
      "The 6AM multi-timeframe read: indicator scorecard, SMC levels, premium vs discount, trade scenarios, and the defined-risk options expression — section by section.",
  },
};

export default function Page() {
  return (
    <LearnPageScaffold
      title="Reading BotWick Analysis — Daily Smart-Money Technical Reports"
      lead="BotWick Analysis is the first tab of the Today page. Every weekday at 6:00 AM ET — hours before the opening bell — it runs a full multi-timeframe technical read on a fixed universe of 21 core names: the mega-cap complex (AAPL, MSFT, NVDA, META, AMZN, GOOG/GOOGL, AVGO, ORCL, NFLX, TSLA), high-beta movers (AMD, MU, PLTR, HOOD, INTC, BABA, SNDK, SPCX), and the index ETFs (SPY, QQQ). Daily bars set the trend and the Smart-Money level map; hourly bars drive the indicator scorecard and entry zones. Every number is computed from live Polygon price data at scan time — nothing is estimated or generated."
      slug="botwick-analysis"
      faqs={[
        {
          question: "What exactly runs at 6:00 AM?",
          answer:
            "For each of the 21 tickers, the engine pulls ~90 days of hourly bars and ~2 years of daily bars from Polygon, cross-checks them against the live snapshot price (a stale or truncated feed refuses to publish rather than show wrong numbers), then computes: the daily-timeframe trend and structure, a 10-indicator scorecard on the hourly, the Smart-Money level map (swing high/low, equilibrium, support/resistance ladders, pivot clusters, fair-value-gap imbalances), a net directional bias, the narrative trade scenarios, and a defined-risk options idea. One report per ticker, all published together.",
        },
        {
          question: "What do the ticker chip colors mean?",
          answer:
            "Each chip is colored by the ticker's net bias: green = bullish, red = bearish, grey = neutral. The bias is anchored by the daily-timeframe trend (EMA20 vs EMA50 posture plus swing structure); when the daily trend is flat, the hourly indicator tally breaks the tie. Hover a chip to see the bias and last price; click it to open the full report.",
        },
        {
          question: "How is the indicator scorecard read?",
          answer:
            "Nine directional indicators are computed on the hourly timeframe, each reduced to Bullish 🟢 or Bearish 🔴: MACD (line vs signal), Vortex (VI+ vs VI−), PSAR (price above/below the stop-and-reverse), DMI (+DI vs −DI), Stochastic (%K vs %D), Momentum (10-bar price change), RSI (above/below 50), MFI (money flow above/below 50), and Fisher Transform (rising/falling). The tenth, ADX, isn't directional — it measures trend STRENGTH: below 20 is weak (choppy, range-bound — fade edges, expect failed breakouts), 20–25 developing, above 25 trending (follow the direction). Hover any tile to see the underlying values.",
        },
        {
          question: "What are swing high, swing low, and equilibrium?",
          answer:
            "The most recent confirmed pivot high and pivot low on the daily chart define the active swing — the range the Smart-Money framework treats as the current dealing range. Equilibrium is its midpoint. Above equilibrium price is trading in 'premium' (expensive half — favored zone to look for shorts in a bearish market); below it is 'discount' (cheap half — favored zone for longs in a bullish market). The swing extremes themselves are the classic liquidity pools where stop-runs and sweeps happen.",
        },
        {
          question: "Where do the support and resistance ladders come from?",
          answer:
            "Two sources, merged and de-duplicated: every confirmed daily pivot high/low near the current price, plus the psychological round numbers ($5 / $10 / $25 increments within ~12% of price). Everything above spot becomes the resistance ladder, everything below becomes support, each capped at the six closest levels. Targets in the trade scenarios walk these ladders in order — shorts walk down the support ladder, longs walk up the resistance ladder.",
        },
        {
          question: "What's a cluster?",
          answer:
            "A price zone where two or more daily pivots landed within about 1.2% of each other — the market turned there repeatedly. The report shows the strongest nearby cluster with its touch count (e.g. '413.90–417.44 (6 touches)'). More touches = more meaningful zone: expect real order flow there, and treat a clean break of a heavy cluster as information.",
        },
        {
          question: "What are supply and demand imbalances?",
          answer:
            "Three-bar fair value gaps (FVGs) on the daily chart — places where price moved so fast it left an untraded gap. A bearish gap above price is a SUPPLY zone: rallies into it tend to stall and reverse, which is why the short scenario keys off it. A bullish gap below price is a DEMAND zone: dips into it tend to find a bid, which is why the long scenario keys off it. The report keeps only the few gaps nearest to current price with sane widths — decision zones, not wallpaper.",
        },
        {
          question: "How should I use the short/long example scenarios?",
          answer:
            "They're pre-written if/then playbooks, not signals. Each names the trigger zone (the nearest supply for shorts, demand for longs), the confirmation to wait for (bearish/bullish engulfing, pin bar, lower-timeframe break, divergence), the targets in ladder order, and where the stop belongs (beyond the relevant swing extreme). The discipline they encode: never enter at the zone without confirmation — let price prove the level is holding or failing first.",
        },
        {
          question: "What is the Options Idea and why is it always a debit spread?",
          answer:
            "It translates the day's bias into one defined-risk options expression: bullish → a call debit spread (long strike near spot, short strike near the resistance target), bearish → a put debit spread (long near spot, short near the support target), roughly 35 days out, strikes snapped to liquid increments. It's a debit spread on purpose — a level-based directional read can be wrong, so the structure caps the loss at the debit paid while keeping leveraged exposure to the move. The 'Open in Risk Graph' link drops the exact legs into the builder so you can see the payoff and adjust. Neutral-bias days get no options idea — there's nothing directional to express.",
        },
        {
          question: "Why is there no report (or a greyed chip) for a ticker some days?",
          answer:
            "The engine refuses to publish numbers it can't trust. If a ticker's bars disagree with the live snapshot price by more than 1.5%, or the freshest bar is more than 7 days old, or the symbol returns insufficient data, that ticker is marked failed for the day (greyed chip, hover shows the reason) — and the other 20 reports publish normally. Wrong numbers are worse than missing numbers.",
        },
        {
          question: "When does it publish, and how does it fit the Today timeline?",
          answer:
            "Weekdays at 6:00 AM ET — the first scan of the day, hours before Pre-market (~8:30), Market-Open (~9:45), the comparative Analysis (~10:15), and Settlement (~5:15 PM). The Today page defaults to the freshest tab as each publishes, but every tab with data stays clickable all day — you can always go back to the BotWick read (or Pre-market) after later scans post. Reports are computed once at scan time; prices move after 6AM, so read the levels as the morning map, not a live quote.",
        },
        {
          question: "Is the math verified?",
          answer:
            "Yes — the production engine is a TypeScript port of a Python reference implementation, and every release is checked bar-for-bar against golden test vectors (120 assertions across synthetic regimes plus captured real market data) covering all ten indicators, the level map, trend, and price action. Separately, the data path guards against the silent-staleness traps in market-data APIs: prices come from the live snapshot (never a possibly-stale bar), and paginated fetches are ordered newest-first so truncation can only cost old history, never recent bars.",
        },
      ]}
      related={[
        { slug: "trade-cards", title: "Reading the Trade Cards" },
        { slug: "analysis", title: "Reading the Analysis Tab" },
        { slug: "risk-graph", title: "Building a Risk Graph" },
      ]}
    >
      <h2>The idea in one paragraph</h2>
      <p>
        Before the market opens, you want two things for each name you trade:
        an honest read of which way it&apos;s leaning, and a map of where the
        important prices are. BotWick Analysis computes both, the same way,
        every morning — a ten-indicator scorecard and trend read for the lean,
        and a Smart-Money level map (swing, equilibrium, ladders, clusters,
        imbalances) for the terrain — then pre-writes the if/then playbook for
        both directions so you&apos;re deciding at 9:30 with a plan instead of
        improvising.
      </p>

      <h2>Reading a report top to bottom</h2>
      <ul>
        <li>
          <strong>Header</strong> — ticker, price at scan time, bias badge, and
          the 📡 data stamp (when the bars end + the live trade the engine
          cross-checked against).
        </li>
        <li>
          <strong>🔍 General Evaluation</strong> — the summary: where price sits
          in the swing (premium vs discount), the daily trend, how one-sided the
          indicators are, and ADX regime.
        </li>
        <li>
          <strong>📉 Technical Indicators</strong> — the 9 directional verdicts
          + ADX strength. Mixed boards with weak ADX = range tactics; one-sided
          boards with strong ADX = trend tactics.
        </li>
        <li>
          <strong>📈 Critical Levels</strong> — swing extremes, ladders, the
          strongest cluster, and the nearest supply/demand imbalances.
        </li>
        <li>
          <strong>💡 Trade Ideas + ✅ Scenarios</strong> — the bias-led primary
          setup and the counter-trend alternative, each with trigger zone,
          confirmation, ladder targets, and stop placement.
        </li>
        <li>
          <strong>🌌 Expectation</strong> — the base case and, explicitly, the
          level that invalidates it and flips the bias.
        </li>
        <li>
          <strong>🎯 Options Idea</strong> — the defined-risk debit spread
          expressing the bias, one click from the Risk Graph.
        </li>
      </ul>

      <h2>What it intentionally doesn&apos;t do</h2>
      <ul>
        <li>
          <strong>It doesn&apos;t update intraday.</strong> One scan, 6:00 AM.
          The levels remain the day&apos;s map, but the price and indicator
          reads age as the session moves — cross-check against the later Today
          tabs.
        </li>
        <li>
          <strong>It doesn&apos;t know about news or earnings.</strong> The read
          is purely technical. An earnings print or headline can invalidate any
          level instantly — check the calendar before leaning on a scenario.
        </li>
        <li>
          <strong>It isn&apos;t advice.</strong> The scenarios are educational
          playbooks. Wait for confirmation, size responsibly, and use the stops.
        </li>
      </ul>
    </LearnPageScaffold>
  );
}
