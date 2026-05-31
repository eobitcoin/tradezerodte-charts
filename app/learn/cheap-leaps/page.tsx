import type { Metadata } from "next";
import LearnPageScaffold from "@/components/LearnPageScaffold";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

export const metadata: Metadata = {
  title: "Reading Cheap LEAPs — Low-IV Long-Term Calls on Quality Names",
  description:
    "Cheap LEAPs combines three independent edges: bottom-quartile IV rank, solid SEC fundamentals, and a healthy pullback within an uptrend. Here's how to read the composite score, the contract pick, and the performance tracker.",
  alternates: { canonical: `${APP_URL}/learn/cheap-leaps` },
  openGraph: {
    type: "article",
    url: `${APP_URL}/learn/cheap-leaps`,
    title: "Reading Cheap LEAPs",
    description:
      "IV rank + fundamentals + setup. Vega-positive 14-20 month calls when all three align.",
  },
};

export default function Page() {
  return (
    <LearnPageScaffold
      title="Reading Cheap LEAPs"
      lead="Cheap LEAPs is a weekly scan for 14-20 month calls where the math actually works: implied vol is in the bottom quartile of its 1-year range (so the contract is genuinely cheap), the company has solid SEC fundamentals (so time is on your side), and the stock has pulled back 25-50% from its 52-week high while staying above its 200-day moving average (so you're buying weakness within a trend, not catching a falling knife). When all three stack, the position has two ways to win — price up (delta) AND vol expansion (vega) — and the entry premium is the cheapest it'll be all year."
      slug="cheap-leaps"
      faqs={[
        {
          question: "Why LEAPs (long-term) instead of shorter calls?",
          answer:
            "Two reasons. (1) Vega: a 14-20 month call's price is dominated by IV, so buying at a 1-year low locks in cheap vol with HUGE upside if IV mean-reverts (which it usually does eventually). Shorter calls don't have the vega exposure. (2) Theta: LEAPs decay slowly — about $0.01-0.03/day per share for a 25-delta 18-month call. You can hold for months without bleeding much. Shorter calls decay 5-10x faster, which means you need to time the move precisely.",
        },
        {
          question: "How does the composite score work?",
          answer:
            "Three component scores, all on a 0-100 scale, blended as 0.4·IV-rank + 0.4·Quality + 0.2·Setup. A pick must clear composite ≥ 55 to be published. IV-rank score = 100 minus the IV percentile (lower IV = higher score). Quality score comes from SEC EDGAR fundamentals (revenue growth, operating margin, cash runway, filing recency). Setup score comes from price action (pullback from 52w high + above 200dma). The 0.4/0.4/0.2 weighting prioritizes vol and fundamentals over the technical setup — those are the durable edges.",
        },
        {
          question: "What's the contract pick rule?",
          answer:
            "For each ticker that clears the composite bar, the scanner walks the Polygon chain and picks the call closest to 25-delta with DTE between 420-600 days (14-20 months). The pick must also pass two liquidity gates: open interest ≥ 200 contracts AND bid-ask spread ≤ 12% of mid. If no contract clears both gates, the ticker is dropped — even if its score was high. That's why you sometimes see 'passed threshold: 6' but 'contracts found: 2' on the cron response.",
        },
        {
          question: "Why 25-delta calls specifically?",
          answer:
            "25-delta is the sweet spot for LEAP convexity. Deeper ITM (40-50 delta) and you're paying mostly intrinsic — less leverage, less vega. Deeper OTM (10-15 delta) and the call is too far out of the money to ever realize most of its potential value — you need a massive move just to break even. 25-delta gives the maximum upside-per-premium ratio while keeping enough probability of finishing ITM to be realistic.",
        },
        {
          question: "How are the three component scores computed?",
          answer:
            "IV-rank score: percentile of current 30d ATM IV vs the ticker's last 365 days of iv_snapshots. Quality score: 30 pts for revenue growth (>20% YoY), 20 for profitable op income, 20 for high gross margin (>50%), 20 for cash runway / not burning, 10 for filing within 120 days. Setup score: 60 for pullback in -25% to -50% sweet spot, +40 if above 200dma. Each component independently gates the others — a 95 IV-rank with a 30 quality score won't pass the composite even with full setup credit.",
        },
        {
          question: "What does the Performance tracker show?",
          answer:
            "Every historical pick from every past scan, sorted by current P&L descending. Entry premium = the mid price when the scan published the pick. Current premium = the latest mark from leap_pick_marks (refreshed daily at 5 PM ET by the leap-marks cron). P&L % = (current − entry) / entry · 100. The table also shows days held, days to expiry, and time since last mark. Picks whose contracts have expired drop off automatically.",
        },
        {
          question: "Why do scores sometimes show '—' for IV rank?",
          answer:
            "We need at least 60 days of iv_snapshots history to compute a stable IV percentile. If a ticker was recently added to the universe (or the backfill is incomplete), the IV-rank cell shows '—' and the IV score contribution to the composite drops to 0. That's why the LEAP watchlist is a SUBSET of the full Options Edge 25 — only tickers with full history qualify.",
        },
        {
          question: "How should I size and manage a LEAP position?",
          answer:
            "Size SMALL — these are 100%-loss-risk positions if the stock flat-lines into expiration. Common rule: never more than 1-2% of portfolio per LEAP. Management: (1) Roll out / take partial profits at +50-75% to lock in vega gains while preserving upside. (2) Cut at -50% if the original thesis breaks (fundamentals deteriorate, stock breaks 200dma). (3) Don't hold into the last 60 days — theta acceleration in the final 2 months is brutal for OTM calls. Roll forward to the next LEAP cycle.",
        },
        {
          question: "Why is the cron on Friday now instead of Sunday?",
          answer:
            "Polygon's options chain on a weekend has stale or missing greeks on long-dated contracts (no live quotes → null delta/IV). Running the scan after the Friday close gives the freshest chain of the week, with settled OI and tight spreads. You still get the post-close-Friday-through-Sunday window to digest before placing orders Monday morning — same effective workflow, much better data quality.",
        },
        {
          question: "How does the daily mark cron work?",
          answer:
            "Every weekday at 5 PM ET, the leap-marks cron walks every leap_pick whose expiration is still in the future, fetches the contract's current snapshot from Polygon's single-contract endpoint, and appends a mark row with the new premium, IV, delta, and underlying spot. This builds a time-series for each pick, which the Performance tracker uses to compute current P&L. Picks with no mark yet (just published, before the first cron run) show '—' until tomorrow.",
        },
      ]}
      related={[
        { slug: "options-edge", title: "Reading Options Edge" },
        { slug: "unusual-activity", title: "Reading Unusual Activity" },
        { slug: "gamma-exposure", title: "Gamma Exposure (GEX) Explained" },
      ]}
    >
      <h2>The three independent edges</h2>
      <p>
        Most LEAP strategies optimize for one edge — either timing the
        bottom (technical) or finding deep value (fundamental). Cheap
        LEAPs requires ALL THREE to align: low-IV-rank + solid
        fundamentals + healthy pullback. The reason is mathematical:
        any single edge in isolation has 50-55% win rates; stacking
        three independent edges multiplicatively pushes you toward
        65-70% on a long-term sample, which is enough to overcome the
        100%-loss risk per position with disciplined sizing.
      </p>

      <h2>Why vol is the dominant edge</h2>
      <p>
        For a 25-delta 18-month call, the position is approximately
        70% vega-driven and 30% delta-driven at entry. That means a
        single point of IV expansion is worth more than a single point
        of underlying move. Buying when IV is at a 1-year low isn&apos;t
        about timing the bottom of the stock — it&apos;s about buying
        vol when nobody else wants it. The vol expansion alone often
        delivers 30-50% returns before the stock has done much.
      </p>

      <h2>Fundamental quality is your TIME insurance</h2>
      <p>
        A LEAP is essentially a bet that the company will exist and be
        worth more 18 months from now. If revenue is growing, op
        income is positive, and there&apos;s no burn-rate risk, time
        is on your side. The 18 months will pass; the stock will have
        opportunities to rally. If the company is melting (declining
        industry, balance sheet stress), time is your ENEMY — every
        day brings closer the point where the LEAP expires worthless.
        The quality score isolates the durable businesses.
      </p>

      <h2>Setup = where you enter, not why</h2>
      <p>
        The setup score (20% of the composite) is intentionally
        smaller than IV rank (40%) and quality (40%). Reason: timing
        the BOTTOM precisely doesn&apos;t matter much for an 18-month
        position. What matters is that you&apos;re buying weakness
        within an uptrend (-25 to -50% off ATH AND above 200dma), not
        chasing strength near all-time highs. The setup filter exists
        to prevent buying at structural tops; it&apos;s not trying to
        nail the exact pivot.
      </p>

      <h2>How to use the page</h2>
      <ol>
        <li>
          Skim the prose summary for the week&apos;s context.
        </li>
        <li>
          Read the top 2-3 picks carefully. Composite ≥ 70 is rare and
          worth highlighting; ≥ 80 is portfolio-grade.
        </li>
        <li>
          For each candidate, glance at the Why line — the routine
          surfaces the specific fundamentals (revenue growth %,
          margins, runway) that drove the quality score.
        </li>
        <li>
          Check the Performance tracker. Picks that have already moved
          +30-50% may be late entries; picks that are -10-20% might be
          better entries if the thesis is still intact.
        </li>
        <li>
          Size conservatively. 1-2% of portfolio per pick is the
          standard. Don&apos;t concentrate.
        </li>
      </ol>

      <h2>What this is NOT</h2>
      <p>
        Cheap LEAPs is a long-vol + long-quality strategy, not a
        trading signal. It assumes you can hold for 6-18 months
        through drawdowns. If the stock craters another 30%, your
        LEAP will be down 60-80% mark-to-market — that&apos;s normal
        for the strategy, NOT a stop-loss. Cut only if the
        FUNDAMENTAL thesis breaks (revenue collapses, margins implode,
        accounting irregularities). Don&apos;t trade these like
        shorter-dated calls — they&apos;re a different animal.
      </p>
    </LearnPageScaffold>
  );
}
