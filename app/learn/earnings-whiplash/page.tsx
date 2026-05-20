import type { Metadata } from "next";
import LearnPageScaffold from "@/components/LearnPageScaffold";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

export const metadata: Metadata = {
  title: "Earnings Whiplash — Implied Move vs Realized Volatility Explained",
  description:
    "The options-implied move is what the market is pricing for a stock's earnings reaction. Compare it to the stock's actual historical post-earnings move to find names where vol is cheap — the asymmetric long-vol setups straddles target.",
  alternates: { canonical: `${APP_URL}/learn/earnings-whiplash` },
  openGraph: {
    type: "article",
    url: `${APP_URL}/learn/earnings-whiplash`,
    title: "Earnings Whiplash — Implied Move vs Realized Volatility Explained",
    description:
      "How the front-month ATM straddle prices implied move, why historical avg matters, and when to buy vol instead of betting on direction.",
  },
};

export default function Page() {
  return (
    <LearnPageScaffold
      title="Earnings Whiplash — Implied Move vs Realized Volatility"
      lead="Every S&P 500 stock has two numbers that matter going into an earnings report: what the options market is pricing in (implied move) and what the stock has actually delivered on past reports (historical avg move). When implied is meaningfully below historical, options are mispriced cheap — that's the asymmetric long-vol setup straddles and strangles target. Here's how the math actually works."
      slug="earnings-whiplash"
      faqs={[
        {
          question: "What is the implied move on an earnings report?",
          answer:
            "It's the magnitude of move the options market is currently pricing in for the post-earnings session. The standard back-of-envelope: take the front-month at-the-money straddle (call mid + put mid) and divide by the underlying price. Example: SPY $520 with a $5.20 straddle = 1.0% implied move. Options buyers are paying for that much expected vol; sellers are short it.",
        },
        {
          question: "How is historical post-earnings move measured?",
          answer:
            "For each of the last N quarters (typically 8 = 2 years), compute the absolute % gap between the close just before earnings and the close just after. Average those |moves|. A stock with a historical avg of 9.1% means it has moved 9.1% on average — up or down — on its last 8 reports.",
        },
        {
          question: "What does it mean when implied is below historical?",
          answer:
            "The options market is pricing in less movement than the stock has typically delivered. If true, premium is cheap relative to the historical sample — long-volatility structures (straddles, strangles) get paid when realized exceeds implied. The 3 names flagged as asymmetric on each scan are the ones with the largest negative IV − HV gap, subject to a minimum threshold so we're not flagging noise.",
        },
        {
          question: "Does 'long vol' mean betting on a directional move?",
          answer:
            "No — that's the whole point. A long-vol setup says 'realized move likely exceeds implied' — direction-agnostic. The standard trade is buying the straddle (ATM call + ATM put) for the post-earnings expiration. You profit if the stock moves more than the total premium in EITHER direction. Direction is irrelevant; magnitude is everything.",
        },
        {
          question: "Why can the asymmetry disappear before earnings?",
          answer:
            "Three common ways: (1) pre-earnings drift consumes the implied move — the stock rallies before the report, so the straddle now sits ATM at a higher strike with less optionality remaining. (2) Analyst downgrade or news re-rates implied vol up, narrowing the gap. (3) Vol regime shift — the broader market suddenly cares about earnings risk and prices all straddles richer. Always re-check the IV vs HV gap before entering.",
        },
        {
          question: "Why 8 quarters of lookback and not more?",
          answer:
            "Earnings patterns drift over time as companies mature, guidance habits change, and analyst coverage evolves. 8 quarters (2 years) is enough sample for statistical signal but recent enough to reflect the current corporate posture. A 20-quarter lookback would include stale management eras and pre-pandemic noise.",
        },
      ]}
      related={[
        { slug: "weekly-research", title: "Weekly Research — How to Read a Setup" },
        { slug: "institutional-flow", title: "13F Institutional Flow" },
        { slug: "0dte-options", title: "What is 0DTE Options Trading?" },
        { slug: "gamma-exposure", title: "Gamma Exposure Explained" },
        { slug: "sector-rotation", title: "Sector Rotation — Leadership Flips" },
      ]}
    >
      <h2>The math, briefly</h2>
      <pre>{`implied_move_pct = (atm_call_mid + atm_put_mid) / underlying_price * 100
historical_avg_pct = mean of |post-earnings session moves| over N quarters
iv_minus_hv = implied_move_pct − historical_avg_pct`}</pre>
      <p>
        <strong>Negative iv_minus_hv</strong> → IV cheap relative to history → long-vol
        candidate.{" "}
        <strong>Positive iv_minus_hv</strong> → IV rich → premium-selling territory (but
        not necessarily a directional trade; see below).
      </p>

      <h2>The flagging logic</h2>
      <p>
        From the top 10 stocks by historical post-earnings move size, flag the 3 with
        the most negative IV − HV gap, subject to: gap ≤ −1.5 percentage points (some
        real cushion vs market noise), liquid ATM chain available, and stock not
        earnings-reporting within 7 trading days (so the setup has time to play out).
        If fewer than 3 names cross the threshold, only those are flagged. Forcing
        three when the signal isn&apos;t there dilutes the read.
      </p>

      <h2>How to execute a flagged setup</h2>
      <p>
        Standard long-vol structure:
      </p>
      <ol>
        <li>Buy the at-the-money call AND put for the expiration AFTER earnings.</li>
        <li>Total cost = the implied move ($ per share, both sides combined).</li>
        <li>Break-evens = strike ± total premium.</li>
        <li>
          If realized move &gt; total premium, you&apos;re in profit — either direction.
        </li>
        <li>If realized move &lt; total premium, you lose the premium.</li>
      </ol>
      <p>
        For a wider payoff curve at lower cost, swap to an out-of-the-money strangle.
        Best when the historical max-move is much larger than the avg-move (right tail
        is fat).
      </p>

      <h2>Honest limits</h2>
      <ul>
        <li>
          <strong>Small sample.</strong> 8 quarters is 8 data points. A stock that&apos;s
          historically violent on earnings can have a calm report. Statistical edge,
          not guarantee.
        </li>
        <li>
          <strong>Vol-regime shifts.</strong> A stock&apos;s post-earnings vol partly
          reflects its own history but also the broader market regime. In low-VIX
          environments, even violent names underdeliver.
        </li>
        <li>
          <strong>Earnings are binary.</strong> A bad beat doesn&apos;t guarantee a down
          move (guidance can save it). A great beat doesn&apos;t guarantee an up move.
          That uncertainty is exactly why long-vol is the cleanest expression of the
          asymmetry idea.
        </li>
      </ul>
    </LearnPageScaffold>
  );
}
