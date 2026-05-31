import type { Metadata } from "next";
import LearnPageScaffold from "@/components/LearnPageScaffold";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

export const metadata: Metadata = {
  title: "Reading the Risk Graph — Multi-Leg Option Trade Builder",
  description:
    "Build any multi-leg option position from the live chain and see the P&L curve at multiple time snapshots. Here's how to read the chart, the headline stats, the Greeks, and the IV-shift slider.",
  alternates: { canonical: `${APP_URL}/learn/risk-graph` },
  openGraph: {
    type: "article",
    url: `${APP_URL}/learn/risk-graph`,
    title: "Reading the Risk Graph",
    description:
      "Multi-leg P&L curves, breakevens, combined Greeks, IV sensitivity, and saving trade ideas.",
  },
};

export default function Page() {
  return (
    <LearnPageScaffold
      title="Reading the Risk Graph"
      lead="The Risk Graph turns the live options chain into an interactive trade builder. Click + to buy and − to sell any strike — the page renders the combined P&L curve in real time, including time-to-expiry snapshots and IV sensitivity. Save trade ideas to revisit them later. The math is pure Black-Scholes, computed in your browser, so the IV slider and quantity tweaks re-render instantly with no server round-trip."
      slug="risk-graph"
      faqs={[
        {
          question: "How do I build a trade?",
          answer:
            "Type a ticker (any liquid US equity or ETF) and press Enter. The chain loads with calls on the left, strikes in the middle, puts on the right. Click + (emerald) to buy or − (rose) to sell any contract. Each click adds a leg to the position panel on the right. You can adjust quantity and entry price per leg, or remove legs with the × button. The risk graph at the bottom updates live as you add or modify legs.",
        },
        {
          question: "What are the curves on the risk graph?",
          answer:
            "Four curves, one per time snapshot. (1) Pink dashed = today (DTE = max DTE across legs). (2) Amber dashed = halfway to expiry. (3) Blue dashed = ~90% of the way to expiry. (4) White solid = at expiry (pure intrinsic value). All four track the SAME position; the difference is theta — how much time decay has eaten into the long legs (or paid the short legs). For a long-vol position, the curves rise as expiry approaches; for a short-vol position, they widen.",
        },
        {
          question: "How are breakevens calculated?",
          answer:
            "Breakevens are the underlying prices where the EXPIRY curve crosses zero. We find them by walking adjacent price-grid points and linearly interpolating the zero-crossing. Most strategies have 0, 1, or 2 breakevens; exotic multi-leg combos can have more. The headline panel shows them as e.g. '$200 / $215' for a strategy with downside and upside breakevens.",
        },
        {
          question: "What's the IV shift slider for?",
          answer:
            "Lets you stress-test the position against IV changes. Move it right (positive) to simulate vol expansion; left (negative) to simulate vol compression. The graph re-renders live with the shifted IV applied additively to every leg. Use it to answer 'what if IV expands 5% before my expiry?' — for long-vol structures, you'll see the curves shift up; for short-vol, they'll shift down. The vega value in the headline tells you the position's $-sensitivity per +1% IV shift.",
        },
        {
          question: "What do the combined Greeks tell me?",
          answer:
            "Delta = $-P&L per +$1 underlying move. Positive = bullish exposure; negative = bearish. Gamma = how fast delta changes per +$1 move — high gamma means the position accelerates. Theta = $-P&L per +1 calendar day (negative = bleeding). Vega = $-P&L per +1% IV. The four together describe the position's first-order response to price, time, and vol changes — read them as 'if X happens, my position changes by Y dollars'.",
        },
        {
          question: "What's the difference between Debit and Credit?",
          answer:
            "Debit (rose) = you PAID net premium to open the position. Max risk is typically the debit (for defined-risk plays); max profit is uncapped for some structures or defined for others. Credit (emerald) = you RECEIVED net premium. Max profit is typically the credit; max risk varies by structure. The headline panel shows whichever applies along with the dollar amount.",
        },
        {
          question: "How do I save a trade idea?",
          answer:
            "After building a position with at least one leg, give it a name (e.g., 'SPY Jan 470 put fly'), optionally add notes about your thesis, and click 'Save trade idea'. The legs, entry prices, IVs, and spot at entry all persist. View saved ideas at /research/risk-graph/saved — clicking any row opens the detail page which recreates the risk graph against the latest live chain.",
        },
        {
          question: "Will saved trades track P&L over time?",
          answer:
            "Wave 1 (now) lets you save and re-render. Wave 2 (coming) adds a daily mark cron that re-prices each saved active position against the live chain, storing the mark in a new table. The saved-idea detail page will then show entry, current mark, P&L, and a time-series chart — same pattern as the LEAPs Performance tracker. This is in the build queue.",
        },
        {
          question: "Why are the math curves slightly off vs my broker's risk graph?",
          answer:
            "Two reasons. (1) We use Black-Scholes with European-style assumptions. American options (most equity options) have very small early-exercise premium that BS doesn't model — usually invisible at the chart scale. (2) We use the IV stored AT ADD-TIME for each leg, not the live IV from the chain (which would re-renormalize on every chain refresh). The IV slider lets you sweep alternate IV scenarios. For ballpark trade planning these differences don't matter; for exact entry-price calculations, always verify on your broker.",
        },
        {
          question: "Can I build calendar spreads / diagonals?",
          answer:
            "Yes — the position builder supports legs at different expiries. Click an expiry tab to switch the chain to a different month, then click +/− on a strike there. The risk graph correctly prices each leg at its own time-to-expiry and applies the IV shift uniformly. Calendars are vega-positive and theta-positive (paid by the front leg) — you'll see the curves shift up as time passes, which is the whole point.",
        },
      ]}
      related={[
        { slug: "options-edge", title: "Reading Options Edge" },
        { slug: "unusual-activity", title: "Reading Unusual Activity" },
        { slug: "gamma-exposure", title: "Gamma Exposure (GEX) Explained" },
        { slug: "cheap-leaps", title: "Reading Cheap LEAPs" },
      ]}
    >
      <h2>What the tool does</h2>
      <p>
        The Risk Graph is a live multi-leg option trade builder. Type
        a ticker, click strikes to add legs, and the P&amp;L curve
        renders in real time across multiple time snapshots. It
        replicates what tools like OptionStrat or ProductionAhead do,
        with the math computed entirely in your browser so slider
        movement is instant.
      </p>

      <h2>How to read the chain table</h2>
      <p>
        Calls are on the left, strikes in the middle, puts on the right.
        Each row shows bid/ask/mid, IV, delta, OI, and volume. The
        ATM strike row is highlighted amber. The +/− buttons on each
        side bubble up an &quot;add leg&quot; event: + buys, − sells.
        Default quantity is 1 contract; you can adjust qty and entry
        price per leg in the position panel.
      </p>

      <h2>How to read the risk graph</h2>
      <ul>
        <li>
          <strong>X axis</strong> = underlying price at expiry (or at
          the snapshot time, for the dashed curves). Range is ±30%
          from spot by default.
        </li>
        <li>
          <strong>Y axis</strong> = total position P&amp;L in dollars,
          summed across all legs and weighted by quantity (× contract
          multiplier 100).
        </li>
        <li>
          <strong>Solid white curve</strong> = at-expiry P&amp;L. This
          is the canonical &quot;outcome&quot; curve — what you make
          or lose if you hold to the last day.
        </li>
        <li>
          <strong>Dashed curves</strong> = P&amp;L at intermediate
          times. The gap between them = theta. For long-vol positions
          this gap closes as expiry approaches; for short-vol it
          widens.
        </li>
        <li>
          <strong>Vertical white line</strong> = current spot.
        </li>
        <li>
          <strong>Horizontal line at zero</strong> = breakeven
          reference. The expiry curve&apos;s zero-crossings are the
          dollar breakeven prices.
        </li>
      </ul>

      <h2>How to use it in practice</h2>
      <ol>
        <li>
          Load the chain for your ticker of interest.
        </li>
        <li>
          Skim the relevant expiry. ATM IV gives you the vol baseline;
          OI tells you which strikes have real liquidity.
        </li>
        <li>
          Build your candidate position: typically 2-4 legs for
          spreads, 3-4 for butterflies and iron condors.
        </li>
        <li>
          Read the headline stats. Verify max risk is acceptable
          relative to your sizing rules.
        </li>
        <li>
          Slide the IV shift to ±10%. If a +10% IV shift collapses
          your P&amp;L, the position is short vega — be careful
          entering before known vol events (earnings, Fed).
        </li>
        <li>
          Save it with a name + notes. Wave 2 will track the position
          over time so you can audit how well it played out vs the
          original thesis.
        </li>
      </ol>

      <h2>What this is NOT</h2>
      <p>
        The Risk Graph is a PLANNING tool, not an execution tool. It
        doesn&apos;t place orders, validate margin requirements, or
        check for assignment risk. Always verify the position on your
        broker before placing the trade. Strike chips and entry prices
        are SUGGESTIONS — real fills will differ slightly. American
        options have small early-exercise premium that Black-Scholes
        ignores. Use the tool to size up the shape of a trade and the
        risk/reward; use your broker to actually trade it.
      </p>
    </LearnPageScaffold>
  );
}
