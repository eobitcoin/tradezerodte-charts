import type { Metadata } from "next";
import Link from "next/link";
import LearnPageScaffold from "@/components/LearnPageScaffold";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

export const metadata: Metadata = {
  title: "Gamma Exposure (GEX) Explained",
  description:
    "GEX measures how aggressively dealers must hedge for a given move in spot. The sign matters: positive GEX dampens volatility, negative GEX amplifies it. Here's how to read regime, walls, and the zero-gamma flip.",
  alternates: { canonical: `${APP_URL}/learn/gamma-exposure` },
  openGraph: {
    type: "article",
    url: `${APP_URL}/learn/gamma-exposure`,
    title: "Gamma Exposure (GEX) Explained",
    description:
      "Dealer hedging mechanics, the zero-gamma flip, positive vs negative regimes, and gamma walls.",
  },
};

export default function Page() {
  return (
    <LearnPageScaffold
      title="Gamma Exposure (GEX) Explained"
      lead="Gamma Exposure is the dollar amount of dealer delta-hedging required for a 1% move in spot. Its sign is the single most useful piece of market microstructure information: positive GEX damps volatility, negative GEX amplifies it. The strike where the sign flips is the zero-gamma flip, and it's where regimes change."
      slug="gamma-exposure"
      faqs={[
        {
          question: "What is Gamma Exposure (GEX) in simple terms?",
          answer:
            "GEX is the dollar amount market makers have to buy or sell of the underlying for every 1% move in spot price. It's quoted as a per-1% number (e.g., 'SPX GEX is +$5B per 1%' means dealers buy $5B if SPX falls 1%, sell $5B if it rises 1%). The sign tells you the regime: positive GEX = dealers damping volatility; negative GEX = dealers amplifying it.",
        },
        {
          question: "What's the difference between positive and negative gamma regimes?",
          answer:
            "Positive gamma (POS) means dealers are net long gamma — they buy dips and sell rips. Markets in POS regimes tend to grind sideways with shallow pullbacks. Negative gamma (NEG) means dealers are net short gamma — they sell dips and buy rips. NEG regimes produce violent extensions, gap moves, and the classic 'why did this rip so hard?' tape. Knowing which regime you're in determines which strategies work.",
        },
        {
          question: "What is the zero-gamma flip strike?",
          answer:
            "The zero-gamma flip is the strike price at which aggregate dealer gamma exposure changes sign. Spot above flip → positive-gamma regime (vol-suppressive). Spot below flip → negative-gamma regime (vol-amplifying). When spot is within ~0.3% of the flip, the regime is unstable and either side can be visited; that's where the riskiest fast moves happen.",
        },
        {
          question: "What are call walls and put walls?",
          answer:
            "A call wall is the strike with the largest concentration of dealer-short call gamma above spot — dealers must sell increasingly as spot approaches it, which acts as resistance. A put wall is the equivalent below spot for puts — dealers buy as spot falls toward it, providing support. Clean breaks of either wall can trigger cascading hedge flows, especially in negative-gamma regimes.",
        },
        {
          question: "Is GEX a reliable trading signal?",
          answer:
            "It's a probabilistic tilt, not a deterministic trigger. GEX models assume dealers hedge mechanically; real dealer behavior involves discretion, basket hedging, and overnight risk limits. Treat regime classification (POS/NEG/FLIP) as a strong prior on which intraday behavior to expect, but always confirm with price action before sizing.",
        },
      ]}
      related={[
        { slug: "max-pain", title: "How Max Pain Works" },
        { slug: "0dte-options", title: "What is 0DTE Options Trading?" },
        { slug: "polymarket-whales", title: "Polymarket Whale Tracking" },
      ]}
    >
      <h2>The intuition: gamma is the second derivative of dealer P&amp;L</h2>
      <p>
        Delta tells you how much an option&apos;s value changes when spot moves
        by $1. Gamma tells you how fast delta itself changes. For a market
        maker, gamma is the curvature of their P&amp;L exposure: a high-gamma
        position means small spot moves rapidly change the position&apos;s
        directional sensitivity.
      </p>
      <p>
        Aggregate that across every option a dealer is short or long, weighted
        by open interest, and you get <strong>dollar gamma exposure</strong> —
        the dollar value of delta the dealer must rebalance for a 1% spot move.
        That&apos;s GEX.
      </p>

      <h2>How dealers actually hedge</h2>
      <p>
        Market makers don&apos;t want directional exposure. When customers buy
        calls from them, dealers go short calls and buy underlying to offset
        the new short delta. When customers buy puts, dealers go short puts
        and short underlying. The net effect: dealer books accumulate gamma
        exposure (positive or negative), and they must continuously rebalance
        the underlying hedge as spot moves.
      </p>

      <h3>Positive gamma — dealers damping volatility</h3>
      <p>
        When dealers are net <strong>long gamma</strong> (positive GEX), their
        hedging behavior is contrarian:
      </p>
      <ul>
        <li>Spot rises → dealer book becomes more long delta → dealers sell underlying to neutralize → that selling absorbs the rally.</li>
        <li>Spot falls → dealer book becomes more short delta → dealers buy underlying → that buying absorbs the dip.</li>
      </ul>
      <p>
        Result: <strong>volatility is suppressed</strong>. Markets in POS regimes
        grind sideways. Pullbacks are shallow. Realized volatility tends to
        under-deliver versus implied. Premium-selling structures (iron condors,
        butterflies, short strangles) work here because the natural drift is
        toward mean-reversion.
      </p>

      <h3>Negative gamma — dealers amplifying volatility</h3>
      <p>
        When dealers are net <strong>short gamma</strong> (negative GEX), the
        sign flips and so does the hedging behavior:
      </p>
      <ul>
        <li>Spot rises → dealer book becomes more short delta → dealers buy underlying to neutralize → that buying accelerates the rally.</li>
        <li>Spot falls → dealer book becomes more long delta → dealers sell underlying → that selling accelerates the decline.</li>
      </ul>
      <p>
        Result: <strong>volatility is amplified</strong>. NEG regimes produce the
        sharp extensions, gap moves, and "wait, why did this rip so hard?" tape
        action. Directional momentum strategies work here; premium-selling gets
        run over.
      </p>

      <h3>The zero-gamma flip</h3>
      <p>
        Aggregate dealer gamma varies by strike. The cumulative gamma is positive
        above some strike, negative below. The strike where it crosses zero is
        the <strong>zero-gamma flip</strong>. Spot above flip = positive regime;
        spot below flip = negative regime.
      </p>
      <p>
        Spot crossing the flip is the most-important microstructural event in the
        day. A market that&apos;s been grinding sideways in positive gamma can
        suddenly extend sharply when spot breaches the flip and dealer hedging
        inverts. The 0DTE Market Research Max Pain scanner alerts on{" "}
        <code>GAMMA_FLIP_CROSS</code> events specifically because of how
        regime-altering they are.
      </p>

      <h2>Gamma walls — concentrated open interest at specific strikes</h2>
      <p>
        Within a regime, certain strikes hold disproportionate gamma. These are
        the &quot;walls.&quot;
      </p>

      <h3>Call walls (resistance above spot)</h3>
      <p>
        The strike with the largest dealer short-call-gamma concentration above
        spot. Dealers must sell increasingly heavily as spot approaches it. On
        the first test, the wall typically holds: spot stalls or reverses. A
        clean break — driven by news flow strong enough to overpower hedging —
        usually carries through to the next wall above.
      </p>

      <h3>Put walls (support below spot)</h3>
      <p>
        The mirror image. The strike with the largest dealer short-put-gamma
        concentration below spot. Dealers buy increasingly as spot falls toward
        it, providing support. A break of the put wall in a negative-gamma
        regime is particularly dangerous: hedge flows can cascade, producing
        crash-style moves.
      </p>

      <h2>Reading GEX in practice</h2>
      <p>
        A typical morning workflow using GEX:
      </p>
      <ol>
        <li>
          <strong>Check the regime</strong>. Where is spot vs the zero-gamma
          flip? POS, NEG, or FLIP (close to the flip, unstable)?
        </li>
        <li>
          <strong>Identify the walls</strong>. Where are the nearest call and
          put walls? Those are your intraday boundaries.
        </li>
        <li>
          <strong>Pick strategies that match the regime</strong>. POS = sell
          premium, fade extremes, target mean reversion. NEG = buy directional
          options, momentum, trend continuation. FLIP = wait for spot to commit
          one side of the flip before sizing.
        </li>
        <li>
          <strong>Watch for regime changes</strong>. A late-morning flip cross
          is the kind of event that should reset your entire playbook.
        </li>
      </ol>

      <h2>Limitations and caveats</h2>
      <ul>
        <li>
          <strong>GEX models assume mechanical hedging</strong>. Real dealers
          use discretion, basket hedge, manage overnight risk. Treat as
          probabilistic, not deterministic.
        </li>
        <li>
          <strong>Open interest is end-of-day</strong>. Intraday positioning
          shifts (especially on 0DTE) aren&apos;t reflected until the next
          morning&apos;s scan.
        </li>
        <li>
          <strong>The flip strike depends on model assumptions</strong>.
          Different providers compute it differently. When they disagree by
          more than 1–2 points, treat the level as uncertain.
        </li>
        <li>
          <strong>Single-stock GEX is noisier than index GEX</strong>. SPX/SPY
          have deep, broad option books that smooth out idiosyncratic flow;
          smaller names can flip overnight on a single institutional unwind.
        </li>
      </ul>

      <p>
        For the daily applied view, the 0DTE Market Research Max Pain &amp; GEX
        scanner publishes the morning snapshot with regime classification,
        per-expiration GEX, walls, and alert stream. See{" "}
        <Link href="/learn/max-pain">Max Pain</Link> for the pinning side of
        the same dealer-positioning story.
      </p>
    </LearnPageScaffold>
  );
}
