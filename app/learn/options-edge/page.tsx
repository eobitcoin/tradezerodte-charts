import type { Metadata } from "next";
import LearnPageScaffold from "@/components/LearnPageScaffold";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

export const metadata: Metadata = {
  title: "Reading Options Edge — Weekly IV Anomaly Scan",
  description:
    "Options Edge surfaces statistically significant volatility-surface anomalies across a 25-ticker universe every Sunday. Z-scores against 1-year history flag rich vol, cheap vol, stretched skew, and unusual term structure. Here's how to read every card.",
  alternates: { canonical: `${APP_URL}/learn/options-edge` },
  openGraph: {
    type: "article",
    url: `${APP_URL}/learn/options-edge`,
    title: "Reading Options Edge — Weekly IV Anomaly Scan",
    description:
      "ATM IV rank, 25Δ skew, term structure, IV/HV ratio — what they mean and how to trade the anomalies.",
  },
};

export default function Page() {
  return (
    <LearnPageScaffold
      title="Reading Options Edge — Weekly IV Anomaly Scan"
      lead="Options Edge runs every Sunday across a locked 25-ticker universe (indexes, mega-cap tech, semis, high-IV retail, sector ETFs). For each ticker it computes four volatility-surface metrics and z-scores them against the ticker's own 1-year history. Anomalies — defined as |z| ≥ 2.0 — get surfaced as ranked cards with suggested strategies and concrete strike chips. The math is deterministic; the routine-written prose adds market context."
      slug="options-edge"
      faqs={[
        {
          question: "What are the four metrics Options Edge scans?",
          answer:
            "(1) ATM IV rank — current 30-day at-the-money IV as a percentile of its 1-year range. (2) Skew z-score — the 25-delta put IV minus 25-delta call IV, z-scored against 1y norm. High = puts unusually rich vs calls. (3) Term structure z-score — 60-day ATM IV minus 30-day ATM IV. High = unusual contango; low = inversion (front-month event premium). (4) IV/HV ratio z-score — implied vol divided by realized vol. High = fat variance risk premium (vol is expensive vs what's actually printing).",
        },
        {
          question: "Why z-score against 1-year history?",
          answer:
            "Raw IV numbers don't tell you anything alone — TSLA at 60% IV could be expensive or cheap depending on its baseline. Z-scoring against the ticker's own 252-day history makes 'expensive vs cheap' meaningful: z=+2 means the current value is two standard deviations above its 1-year mean, which historically marks the kind of extreme that mean-reverts. The threshold |z| ≥ 2.0 surfaces only statistically meaningful deviations.",
        },
        {
          question: "What does the green 'Anomalies' box at the top show?",
          answer:
            "The 2-3 most extreme anomalies of the week, lifted out of the routine's prose summary into a hero box for scan-and-go reading. Each line names the ticker, the anomalous metric, the z-score, and the routine's color around why it matters. The same picks also appear lower in the ranked-anomalies list with full surface data and suggested strikes.",
        },
        {
          question: "How do I read a ranked anomaly card?",
          answer:
            "Top row: ticker · metric chip · direction chip (Stretched high / Stretched low) · z-score and percentile. Strategy line: the routine's suggested trade structure. Strike chips: emerald = buy legs, rose = sell legs, with concrete strikes computed via delta-target inversion and snapped to the listed grid. Surface mini-table: underlying spot, ATM IV 30d, 25Δ put IV, 25Δ call IV, HV 30d — the raw context. Read top to bottom for the call.",
        },
        {
          question: "How are the suggested strikes computed?",
          answer:
            "Strikes use the standard log-normal delta-target approximation: K(δ) ≈ S · exp(±N⁻¹(δ) · σ · √T), with N⁻¹(0.25) = 0.6745 for 25Δ legs and N⁻¹(0.10) = 1.2816 for 10Δ wings. T = 30/365. Output is snapped to the nearest listed-options grid (typically $5 above $200, $1 below). They're approximations — meant as a starting point, not a quote. The actual chain might have slightly different listed strikes; verify on your broker before sending an order.",
        },
        {
          question: "What's a 'Notable extreme' callout at the top?",
          answer:
            "When any single anomaly has |z| > 3.5 (roughly once per quarter per metric per name), the routine flags it as Notable Extreme. That's tail-of-distribution territory — historically the most reliable mean-reversion setup. Doesn't guarantee anything, but it's the highest-conviction signal the scanner produces.",
        },
        {
          question: "How should I size and time these trades?",
          answer:
            "Size small. These are statistical mean-reversion trades, not directional certainties — a +2σ anomaly can become a +3σ before reverting. Timing: most short-vol structures (iron condor on rich IV) work best held to expiration or rolled at 50% max profit. Long-vol structures (straddle on cheap IV) need a catalyst — earnings, Fed, OPEX — to monetize the vega expansion. The 'Risks & caveats' section in the routine's summary flags upcoming events that could change the picture.",
        },
        {
          question: "Why only 25 tickers? Can the universe expand?",
          answer:
            "The universe is locked because every name requires 1 year of IV history (the iv_snapshots backfill) to z-score against. Expanding means running the backfill for the new ticker first, which is a one-time job per name. The current 25 covers indexes (SPY/QQQ/IWM), mega-cap tech, semis, high-IV retail, and sector ETFs — enough breadth to surface meaningful anomalies every week without being noisy.",
        },
        {
          question: "What if NO anomalies cleared the bar?",
          answer:
            "It still publishes — 'No anomalies cleared the |z| ≥ 2.0 threshold this scan. The volatility surface across the universe is sitting within its 1-year norms.' The absence of edge is itself information: a calm regime where short-vol systematic strategies work fine but there's no specific edge worth chasing.",
        },
        {
          question: "How does Options Edge fit with Unusual Activity and GEX?",
          answer:
            "Three layers of the same picture. Options Edge = the SURFACE (where is vol mispriced statistically). Unusual Activity = the FLOW (who's positioning, and how aggressively). GEX = the HEDGING (what dealers will be forced to do as price moves). A trade with all three aligned — say, low IV rank + heavy bullish call buying + positive dealer gamma at the strike — is much higher conviction than any one signal alone.",
        },
      ]}
      related={[
        { slug: "unusual-activity", title: "Reading Unusual Activity" },
        { slug: "gamma-exposure", title: "Gamma Exposure (GEX) Explained" },
        { slug: "cheap-leaps", title: "Reading Cheap LEAPs" },
      ]}
    >
      <h2>What you&apos;re looking at</h2>
      <p>
        Every Sunday afternoon, the Options Edge routine pulls the live options
        chain for all 25 watchlist tickers, computes four IV-surface metrics
        per ticker, and z-scores each against the ticker&apos;s own 1-year
        history stored in the <code>iv_snapshots</code> table. Anomalies
        (|z| ≥ 2.0) are ranked by absolute z-score and published as cards on
        this page, with a routine-written prose summary up top and a
        deterministic strategy + strike suggestion per card.
      </p>

      <h2>The four metrics, in plain English</h2>
      <h3>1. ATM IV rank</h3>
      <p>
        Where today&apos;s 30-day at-the-money implied vol sits within the
        ticker&apos;s last 252 days of ATM IV. Rank 95 = top 5% of the
        1-year range (vol is historically expensive). Rank 5 = bottom 5%
        (historically cheap). High rank favors selling premium structures;
        low rank favors buying gamma.
      </p>

      <h3>2. 25-delta skew z-score</h3>
      <p>
        The spread between the 25-delta put IV and the 25-delta call IV,
        z-scored against the ticker&apos;s 1-year norm. Positive skew
        (puts richer than calls) is normal in equity options; what matters
        is whether the spread is at its NORMAL level or stretched.
        High z = puts unusually rich → risk-reversal (sell put, buy call)
        captures the mean reversion. Low z = puts unusually cheap → reverse
        risk-reversal.
      </p>

      <h3>3. Term-structure z-score</h3>
      <p>
        The 60-day ATM IV minus the 30-day ATM IV, z-scored. Normal markets
        have positive term (longer-dated vol &gt; near-dated). When this
        widens unusually high, near-dated vol is cheap relative to back
        month — calendar spreads work. When it flips negative (inverted),
        front-month vol is bid for an event — buy back-month, let front
        bleed.
      </p>

      <h3>4. IV/HV ratio z-score</h3>
      <p>
        Implied vol divided by realized vol, z-scored. This is the
        &quot;variance risk premium&quot; — how much extra the market is
        paying for protection vs what the underlying is actually moving.
        High z = fat premium, short-vol pays. Low z = realized is hotter
        than implied, long-vol pays.
      </p>

      <h2>How to use the page</h2>
      <ol>
        <li>
          <strong>Read the green Anomalies box first.</strong> The 2-3
          most extreme picks of the week with the routine&apos;s context.
        </li>
        <li>
          <strong>Scan the ranked list below.</strong> Cards are ordered
          by |z| descending — biggest deviations first. Each card has
          everything you need to evaluate: surface values, suggested
          structure, concrete strikes.
        </li>
        <li>
          <strong>Cross-check with the prose summary.</strong> Catalysts,
          earnings within 21 days, Fed meetings, OPEX — the routine flags
          anything that could explain (or undermine) the statistical
          signal. A high-z anomaly on a name with earnings next week
          isn&apos;t mispricing; it&apos;s event premium.
        </li>
        <li>
          <strong>Verify strikes on your broker.</strong> The chip strikes
          are computed from a model — listed strikes might be a tick off.
        </li>
      </ol>

      <h2>What this is NOT</h2>
      <p>
        Options Edge is a statistical anomaly screener, not a directional
        forecast. A +2σ ATM IV rank doesn&apos;t mean the stock will move
        less; it means vol is statistically expensive, and short-vol
        positions are FAVORED — not guaranteed. Black swans break the
        pattern. Size accordingly.
      </p>
    </LearnPageScaffold>
  );
}
