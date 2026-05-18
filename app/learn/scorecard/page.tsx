import type { Metadata } from "next";
import LearnPageScaffold from "@/components/LearnPageScaffold";

const APP_URL = process.env.APP_URL || "https://www.tradezerodte.com";

export const metadata: Metadata = {
  title: "Scorecard — Tracking 0DTE Performance Across Sessions",
  description:
    "The Scorecard tab aggregates every published settlement post into a single cross-day view: cumulative P&L, win rate, session-by-session bar chart, per-ticker leaderboard. Here's what each number means and how to read the chart.",
  alternates: { canonical: `${APP_URL}/learn/scorecard` },
  openGraph: {
    type: "article",
    url: `${APP_URL}/learn/scorecard`,
    title: "Scorecard — Tracking 0DTE Performance Across Sessions",
    description:
      "How the Scorecard aggregates settlement posts into cumulative P&L, win rate, session time-series, and per-ticker breakdown.",
  },
};

export default function Page() {
  return (
    <LearnPageScaffold
      title="Scorecard — Tracking 0DTE Performance Across Sessions"
      lead="The Scorecard tab is the cross-day aggregate of every settlement post published to date. The TRADE CARDS tab shows today's plan; the Scorecard shows the trend — cumulative P&L, win rate, best/worst sessions, and which tickers consistently pay versus which are noise."
      slug="scorecard"
      faqs={[
        {
          question: "What's in the Scorecard?",
          answer:
            "Four sections, top to bottom: (1) a KPI strip with sessions, net P&L%, win rate, trades settled, and best session; (2) a session P&L bar chart with one bar per trading day; (3) a per-ticker leaderboard sorted by net P&L; (4) a recent-sessions list with click-throughs to each day's trade cards.",
        },
        {
          question: "How is net P&L computed?",
          answer:
            "Per-trade P&L% comes from the deterministic settlement engine — actual fill price → actual exit price, expressed as a percentage of the entry premium. Session P&L is the sum across all resolved trades that day. Net P&L is the sum across every settled session. No position-sizing is applied — these are raw per-contract percentages, not portfolio returns.",
        },
        {
          question: "What does the win rate represent?",
          answer:
            "wins / (wins + losses). Wins are trades that hit Target 1 or Target 2. Losses are trades that hit the stop. No-fills, time-stops, and manual exits are excluded from both numerator and denominator — they're tracked as their own buckets in the breakdown. The win rate is conservative; a high time-stop count means many trades just didn't resolve cleanly.",
        },
        {
          question: "Why does the time-series chart have green AND red bars?",
          answer:
            "Each bar represents one trading day's net P&L%. Green = positive day, red = negative day. The dashed line at the middle is zero. Bars extending up are green wins; bars extending down are red losses. Bar height is proportional to the magnitude of P&L%. Hover a bar to see the date, P&L%, and W/L count. Click a bar to jump to that day's trade cards.",
        },
        {
          question: "What's a 'session' in this context?",
          answer:
            "One trading day where the post-close settlement scan published outcomes. Each row in the session list = one (trading_day, scan_kind='settlement') tuple in the database. Days that haven't been settled yet (e.g. today before 4:15 PM ET) don't appear in the Scorecard at all.",
        },
        {
          question: "How does the per-ticker leaderboard work?",
          answer:
            "Aggregates outcomes across every session for each ticker. Sortable by net P&L (default — green at top, red at bottom). 'Sessions' counts how many days that ticker had a trade plan; 'W' / 'L' / 'No-fill' / 'Time-stop' tally the per-trade buckets. Win rate is the same formula as the overall (wins / (wins + losses)). Surfaces which tickers consistently pay vs which are net-loss drags worth re-thinking.",
        },
        {
          question: "What's the difference between 'Best session' and 'Best ticker'?",
          answer:
            "Best session = the single trading day with the highest net P&L%. Best ticker = the ticker whose aggregate P&L% across all sessions is highest. They answer different questions: best session tells you 'what was your peak performance day,' best ticker tells you 'where does the alpha actually come from over time.'",
        },
        {
          question: "When does the Scorecard update?",
          answer:
            "Server-side query on every page load (force-dynamic). The moment a new settlement post lands in the database, the next page load reflects it — KPIs, chart, leaderboard, recent sessions all rebuild. No caching, no manual refresh needed.",
        },
        {
          question: "Why are no-fills and time-stops not counted as losses?",
          answer:
            "A no-fill means no money was risked — the entry trigger never fired or the option never traded in the zone. A time-stop means the trade exited per the original plan (not on a thesis-invalidation signal). Both are legitimate outcomes that aren't the same as a directional loss. Counting them as losses would understate the actual edge of the setups that DID execute and resolve cleanly.",
        },
        {
          question: "What about position sizing — is this real account P&L?",
          answer:
            "No. The Scorecard tracks per-contract premium P&L% — purely the trade plan's edge. Actual account returns depend on position sizing, contract count, slippage, and commissions, which vary by trader. Use the Scorecard to measure the plan's edge over time; size your own positions to match your risk tolerance.",
        },
      ]}
      related={[
        { slug: "trade-cards", title: "Reading the Trade Cards" },
        { slug: "0dte-options", title: "What is 0DTE Options Trading?" },
        { slug: "weekly-research", title: "Weekly Research Stack" },
        { slug: "max-pain", title: "Max Pain" },
      ]}
    >
      <h2>How the math actually works</h2>
      <ul>
        <li>
          <strong>Per-trade P&amp;L%</strong> = (actual_exit − actual_entry) /
          actual_entry × 100. Computed by the settlement engine, not the LLM.
        </li>
        <li>
          <strong>Session net P&amp;L%</strong> = Σ (per-trade P&amp;L%) across
          all resolved trades that day. No position-sizing weighting.
        </li>
        <li>
          <strong>Cumulative net P&amp;L%</strong> = Σ (session net P&amp;L%)
          across every settled session.
        </li>
        <li>
          <strong>Win rate</strong> = wins / (wins + losses). No-fills,
          time-stops, manual exits are excluded.
        </li>
      </ul>

      <h2>The buckets, explained</h2>
      <ul>
        <li>
          <strong>W (wins).</strong> Target 1 or Target 2 hit before stop.
        </li>
        <li>
          <strong>L (losses).</strong> Stop hit before any target.
        </li>
        <li>
          <strong>No-fill.</strong> Entry never executed. The option premium
          didn&apos;t trade in the planned entry zone during the session.
        </li>
        <li>
          <strong>Time-stop.</strong> Trade was still open when the planned
          time-stop fired. Exit at the close of the time-stop bar.
        </li>
        <li>
          <strong>Manual exit.</strong> Trade was still open at the 4:00 PM
          session close. Marked-to-close.
        </li>
        <li>
          <strong>Killed.</strong> Plan was invalidated before execution by a
          later scan (e.g. market-open killed it). Not a loss — just a no-trade.
        </li>
      </ul>

      <h2>Reading the time-series chart</h2>
      <p>
        Bars are anchored on the dashed zero-line. Green bars extending
        upward = positive sessions; red bars extending downward = negative.
        Bar height scales to the largest absolute P&amp;L% in the window, so a
        20% session and a 60% session don&apos;t look the same height — the
        60% bar will be 3× taller.
      </p>
      <p>
        The chart is intentionally simple: no cumulative-line overlay, no
        moving averages, no fitted trendlines. The point is to spot streaks and
        outliers at a glance. Hover for the exact P&amp;L; click to jump to
        that day&apos;s trade cards for a deeper read.
      </p>

      <h2>What the Scorecard does NOT tell you</h2>
      <ul>
        <li>
          <strong>Account-level returns.</strong> Per-contract premium
          P&amp;L% is not the same as portfolio return. A +50% on a $1 option is
          $50 per contract; sizing decides whether that&apos;s meaningful.
        </li>
        <li>
          <strong>Drawdowns.</strong> Sum-of-percentages doesn&apos;t compound
          like a real account. A −50% day followed by a +50% day is &ldquo;0
          net&rdquo; here but would actually be −25% in a compounding account.
        </li>
        <li>
          <strong>Risk-adjusted performance.</strong> No Sharpe, no Sortino, no
          MAR. Each session is treated as one observation regardless of how
          many trades it contained.
        </li>
        <li>
          <strong>Slippage and commissions.</strong> Engine assumes fills at
          the midpoint of the planned entry zone. Real fills will vary.
        </li>
      </ul>
    </LearnPageScaffold>
  );
}
