import type { Metadata } from "next";
import LearnPageScaffold from "@/components/LearnPageScaffold";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

export const metadata: Metadata = {
  title: "Reading Earnings Scans — Pre-Earnings Options Strategy Ranker",
  description:
    "Every Sunday, Earnings Scans ranks every US-listed company reporting next week across four pre-earnings options strategies (Rush, Condor, Straddle, Breakout). Straddle and Condor are gated by real 6-cycle Polygon-priced backtests; Rush and Breakout use V1 heuristic scores. Here's how to read every column, score, chip, and banner.",
  alternates: { canonical: `${APP_URL}/learn/earnings-scans` },
  openGraph: {
    type: "article",
    url: `${APP_URL}/learn/earnings-scans`,
    title: "Reading Earnings Scans — Pre-Earnings Options Strategy Ranker",
    description:
      "Strategy scores, V3 backtest confidence tiers, and how to triage Straddle / Condor / Rush / Breakout picks each week.",
  },
};

export default function Page() {
  return (
    <LearnPageScaffold
      title="Reading Earnings Scans — Pre-Earnings Options Strategy Ranker"
      lead="Earnings Scans runs every Sunday across every US-listed company reporting earnings in the upcoming work week. For each ticker that has liquid options (total chain OI ≥ 5,000), it computes four strategy scores and — for Straddle and Condor — runs a real 6-cycle backtest against Polygon's historical option chains. The result is a per-strategy ranked list with real win-rate data on two of the four strategies and V1 heuristic scores on the other two."
      slug="earnings-scans"
      faqs={[
        {
          question: "What are the four strategies?",
          answer:
            "(1) Earnings Rush — long IV before the earnings event, exit before the report. Bets on IV expansion into earnings. (2) Iron Condor — short an OTM put spread and OTM call spread through earnings. Bets on IV crush and a bounded move. (3) Straddle — buy ATM call + ATM put through earnings. Bets that the move exceeds what options are pricing in. (4) Breakout — directional pre-EE bet aligned with the ticker's historical post-EE move bias.",
        },
        {
          question: "What does the 0-100 strategy score mean?",
          answer:
            "It's a V1 heuristic confidence number. For Straddle: scales linearly with historical |move| / implied move — higher when stocks have historically moved MORE than options are pricing in. For Condor: the inverse — higher when historical |move| is LESS than implied. For Breakout: scales with how often past EEs moved in the same direction. For Rush: scales with implied move magnitude and historical reliability. The badge is emerald at ≥60 (favorable setup), amber 40-59 (neutral), rose <40 (disfavored). Hovering or clicking shows the rationale string explaining the math.",
        },
        {
          question: "What's the 'V3 BACKTEST' label on Straddle and Condor?",
          answer:
            "Those two tabs replace the V1 guess with HISTORICAL FACT. For each ticker reporting next week, the engine pulls the last 6 earnings cycles, reconstructs what the actual options chain looked like at each entry date, fetches real Polygon contract bars, simulates entry 4 trading days before EE and exit 1 trading day after, and computes per-cycle P&L using real prices. The result: Win %, Avg ROI, Wins:Losses, and a sparkline of every cycle's outcome — emerald bar up for wins, rose bar down for losses.",
        },
        {
          question: "What do STRONG / WEAK / THIN confidence chips mean?",
          answer:
            "Sample-size tiers for backtest reliability. STRONG (emerald) = ≥4 of the 6 attempted cycles produced priceable data — trust the win-rate. WEAK (amber, 80% opacity) = 2-3 cycles only — directional read, sample too small to commit capital. THIN (gray, 55% opacity) = 1 cycle — informational. A 100% win on 1 cycle is statistically meaningless, so the tier-first sort ensures it never outranks a 60% on 5 cycles.",
        },
        {
          question: "Why does the top of the tab sometimes say 'No qualified candidates'?",
          answer:
            "That banner appears when zero tickers reporting this week have ≥4 priceable historical cycles for the strategy. Common causes: a slow earnings week (few liquid names reporting), recent IPOs that don't have 6 quarters of earnings history yet, or thinly-traded names where Polygon's historical contract aggregates are sparse. It's the signal working, not the page breaking. The same banner has three tones: emerald when there ARE strong picks (showing the count), amber when only WEAK picks exist (watchlist only), gray when nothing qualifies.",
        },
        {
          question: "Why are Rush and Breakout still on V1 heuristic scores?",
          answer:
            "V3.1 shipped the Straddle backtest. V3.2 shipped the Condor backtest. V3.3 (Breakout) and V3.4 (Rush) are next — each strategy needs its own price-simulation logic since the leg structure and ROI calculation differ. Until then, use Rush and Breakout as DIRECTIONAL screens — high-conviction setups worth investigating in your broker's tools — not as backtest-confirmed picks. The score and rationale tell you the V1 logic; verify the actual option prices and earnings dates against your broker before trading.",
        },
        {
          question: "How do I tell a real backtest signal from noise?",
          answer:
            "Trust the row when: (1) tier is STRONG (≥4 cycles), (2) win rate is decisive — ≥60% or ≤30%, not random-looking 45-55%, (3) Avg ROI is materially positive or negative, not near zero, (4) the sparkline shows mostly one color rather than alternating wildly. Ignore the row when: tier is THIN or WEAK, win rate is near 50% with low avg ROI, or the sparkline is 50/50 noise. The Strategy Score column (the 0-100 number) is V1 heuristic only — it doesn't tell you whether the backtest is reliable. Always cross-check it with the backtest tier.",
        },
        {
          question: "What's the difference between 'Hist |move|' and 'Hist max'?",
          answer:
            "Hist |move| is the median absolute % move over the available history (typically 6-12 cycles). It's the 'typical' move — the half-and-half line. Hist max is the worst single move (max-magnitude in either direction) — the tail. Both matter: median tells you what's likely; max tells you what's possible. A condor with hist max far past implied move is risky even if hist |move| looks tame, because one tail event blows the whole structure.",
        },
        {
          question: "What does the Implied Move column mean?",
          answer:
            "The ATM straddle priced as a percentage of spot — i.e. what options are pricing as the expected move through expiration. It's roughly equivalent to 1 standard deviation of the post-EE move distribution. If implied move is 8% and historical |move| has averaged 4%, options are 'rich' (Straddle disfavored, Condor favored). If implied is 4% and historical is 8%, options are 'cheap' (Straddle favored, Condor disfavored).",
        },
        {
          question: "How are Condor strikes sized?",
          answer:
            "Short strikes at 1.0× implied move OTM (both put-side and call-side), long-wing strikes at 1.5× implied move OTM. Wing width = 0.5× implied move. Strikes are snapped to a price-tier-aware grid: $0.50 below $25, $1 below $100, $2.50 below $250, $5 above. The backtest ROI denominator is MAX LOSS (= wing width − net credit), not entry credit — because credit goes INTO your account, so the true 'return on risk' uses capital actually at stake.",
        },
        {
          question: "What does the BUILD button do?",
          answer:
            "Drops the ticker into the Risk Graph builder with the suggested strategy structure pre-populated (ATM straddle for Straddle, 4-leg condor for Condor, single-leg directional for Breakout/Rush). You can then tweak strikes, IV, DTE, and quote-state, save it as a trade idea, and track P&L through the actual earnings event. It's the bridge from 'this row looks interesting' to 'here's what the actual position looks like.'",
        },
        {
          question: "Why isn't every ticker in the universe shown?",
          answer:
            "The scan starts from Finnhub's full earnings calendar for the work week (typically 100-200 tickers in earnings season), then filters to names with total option chain OI ≥ 5,000. Sub-5k-OI tickers are dropped because the strategies would fill terribly — the bid/ask spread on illiquid options is wider than the expected edge. The 'computed' count in the header is what survived the filter. In a slow week, that can drop to 30-40; in peak earnings season (late January, late April, late July, late October), it's 80-120.",
        },
        {
          question: "When does the scan run? Can I trigger it manually?",
          answer:
            "Scheduled for Sunday 22:00 UTC (5/6 PM ET), so the data is ready for Monday open. Total runtime is currently 5-8 minutes for ~40-tier universe (chain fetch + 6-cycle backtest per ticker for Straddle + Condor). The scan is idempotent — the upcoming-week's Monday is the key, so re-running just overwrites the same row. Manual triggers go through the bearer-token cron endpoint at /api/cron/earnings-scan; that's how we ran V3.2 mid-week for verification.",
        },
      ]}
      related={[
        { slug: "risk-graph", title: "Building a Risk Graph" },
        { slug: "options-edge", title: "Reading Options Edge" },
        { slug: "earnings-whiplash", title: "Earnings Whiplash Brief" },
      ]}
    >
      <h2>The four strategies in one paragraph each</h2>

      <h3>Earnings Rush — long IV before the report</h3>
      <p>
        IV typically expands into earnings as uncertainty builds, then crushes
        the morning after the report. Rush plays the expansion: enter a long
        call or long straddle 5-10 trading days pre-EE,{" "}
        <strong>close BEFORE the announcement</strong>. Wins on vega regardless
        of which way the underlying moves. The V1 score is high when implied
        move is materially elevated (≥3%) AND the ticker historically delivers
        decent move magnitude — both inputs are needed for the IV expansion to
        be reliably tradeable.
      </p>

      <h3>Iron Condor — short premium through the event</h3>
      <p>
        Sell an OTM put spread + an OTM call spread, held{" "}
        <strong>through</strong> the report. Wins on IV crush plus stock
        staying inside the inner strikes. The V1 score scales with (implied
        move − historical |move|) — bigger gap = more juice to harvest, less
        risk of the wings being tested. The V3.2 backtest replaces that guess
        with: did this exact 1.0×/1.5× condor structure actually make money
        across the last 6 earnings? Win %, Avg ROI, sparkline — straight from
        Polygon contract aggregates.
      </p>

      <h3>Straddle — long premium through the event</h3>
      <p>
        Buy ATM call + ATM put, hold{" "}
        <strong>through</strong> the report, exit after the IV crush. Wins
        when the stock moves further than the straddle cost. The V1 score is
        the inverse of Condor: high when historical |move| has reliably
        EXCEEDED implied move. The V3.1 backtest checks: simulating this
        exact ATM-straddle trade on the last 6 earnings cycles using real
        Polygon prices, what was the actual Win % and Avg ROI?
      </p>

      <h3>Breakout — directional bet on follow-through</h3>
      <p>
        Some stocks have a strong post-EE directional bias — they consistently
        rip in one direction after earnings (or consistently dump). Breakout
        buys a single-leg call or put pre-EE aligned with that bias. The V1
        score uses sign-match-rate (% of past EEs that moved bullish vs
        bearish) and average move magnitude. Currently V1 heuristic only;
        V3.3 backtest is pending.
      </p>

      <h2>How sort order works</h2>
      <p>
        On <strong>Straddle</strong> and <strong>Condor</strong> tabs, rows are
        sorted by:
      </p>
      <ol>
        <li>
          <strong>Confidence tier descending</strong> — STRONG before WEAK
          before THIN before none. A 60% win rate on 5 cycles ranks above a
          100% win rate on 1 cycle, every time.
        </li>
        <li>
          <strong>Avg ROI descending</strong> — within tier, the trade that
          made more money historically ranks first.
        </li>
        <li>
          <strong>V1 heuristic score descending</strong> — final tie-breaker
          when backtest data is sparse.
        </li>
      </ol>
      <p>
        On <strong>Rush</strong> and <strong>Breakout</strong> tabs (pending
        V3.3 / V3.4), rows are filtered to V1 score ≥ 50 and sorted by score
        descending. The ≥50 floor exists because the V1 heuristic is noisy at
        the low end and showing every 0-49 row would drown the signal.
      </p>

      <h2>The banner state machine</h2>
      <p>
        The top of every backtested tab shows one of three banners:
      </p>
      <ul>
        <li>
          <strong>Emerald — ✓ N STRONG PICKS:</strong> N tickers cleared the ≥4-cycle
          bar. Those are the actionable rows — focus there.
        </li>
        <li>
          <strong>Amber — ⚠ NO STRONG PICKS:</strong> No row hit ≥4 cycles,
          but at least one returned 2-3 (WEAK). Treat the WEAK rows as a
          watchlist worth monitoring; don&apos;t commit capital based on a 2-3
          cycle sample alone.
        </li>
        <li>
          <strong>Gray — NO QUALIFIED CANDIDATES:</strong> Zero rows have
          enough priceable historical option cycles to produce a reliable
          backtest. This is common in slow earnings weeks or for weeks
          dominated by recent IPOs. The absence of edge is itself
          information — there&apos;s nothing this scanner finds tradeable, so
          go work on something else.
        </li>
      </ul>

      <h2>Common confusion: V1 score vs V3 backtest</h2>
      <p>
        Important distinction: the 0-100 Strategy Score is{" "}
        <strong>V1 heuristic</strong> — a smart guess based on comparing
        implied move to historical |move|. The Win % / Avg ROI / sparkline
        cell on Straddle and Condor tabs is{" "}
        <strong>V3 backtest</strong> — actual P&L from simulating the
        strategy on real historical Polygon prices. They can disagree:
      </p>
      <ul>
        <li>
          A V1 score of 76 with WEAK or THIN backtest tier means &ldquo;the
          setup looks favorable on paper, but we don&apos;t have enough
          historical data to confirm it actually works for this ticker.&rdquo;
        </li>
        <li>
          A V1 score of 30 with STRONG +40% Avg ROI backtest means the heuristic
          underrates this setup — the real history says the trade has worked.
          Trust the backtest.
        </li>
        <li>
          When both agree (high V1 + STRONG positive backtest), that&apos;s the
          highest-conviction pick of the week.
        </li>
      </ul>

      <h2>Mechanics under the hood</h2>
      <p>
        The backtest engine for one ticker:
      </p>
      <ol>
        <li>
          Fetch the last 6 earnings dates from Finnhub.
        </li>
        <li>
          Fetch underlying daily bars for the full date range (one Polygon
          call per ticker).
        </li>
        <li>
          Fetch the current option chain once to determine the ticker&apos;s
          expiry cadence (weekly / monthly / both).
        </li>
        <li>
          For each past earnings cycle:
          <ul>
            <li>
              Compute entry date (4 trading days pre-EE) and exit date (1
              trading day post-EE, accounting for BMO/AMC timing).
            </li>
            <li>
              Pick strikes — ATM-rounded for Straddle, 1.0×/1.5× implied move
              for Condor (sized by current implied move applied to entry-day
              spot).
            </li>
            <li>
              Build OPRA contract tickers (e.g.{" "}
              <code>O:AAPL250117C00150000</code>).
            </li>
            <li>
              Fetch per-contract aggregates for the entry-to-exit window
              (Polygon <code>/v2/aggs/ticker/O:.../range/1/day/...</code>).
            </li>
            <li>
              Compute entry price, exit price, per-cycle P&L, ROI.
            </li>
          </ul>
        </li>
        <li>
          Aggregate the cycles into Win %, Avg ROI, cyclesUsed (cycles that
          produced priceable bars), totalCycles (cycles attempted).
        </li>
      </ol>
      <p>
        Cycles can fail to price for legit reasons: thinly-traded historical
        strikes, weekly expiries that weren&apos;t listed back then, holiday
        gaps, contract tickers that don&apos;t exist for low-priced names
        with wide strike grids. Those failures show up as the{" "}
        <em>cyclesUsed &lt; totalCycles</em> gap and drive the confidence tier
        down accordingly.
      </p>

      <h2>What to do with this every week</h2>
      <ol>
        <li>
          <strong>Sunday night / Monday morning:</strong> open the page,
          check the banner state on Straddle and Condor.
        </li>
        <li>
          <strong>If STRONG picks exist:</strong> open the top 2-3 rows. Read
          the Win %, Avg ROI, and sparkline. Cross-check the V1 rationale.
          Hit BUILD to drop the structure into Risk Graph.
        </li>
        <li>
          <strong>If only WEAK / THIN / none:</strong> skip the backtested
          tabs. Glance at Rush and Breakout for directional ideas. If nothing
          there either, go work on something else — there&apos;s no edge
          this week.
        </li>
        <li>
          <strong>Cross-reference:</strong> Options Edge anomalies + GEX
          dealer-positioning often line up with the same names this scanner
          flags. A trade with backtest confirmation + IV anomaly + GEX
          alignment is much higher conviction than backtest alone.
        </li>
      </ol>
    </LearnPageScaffold>
  );
}
