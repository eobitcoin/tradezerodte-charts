import type { Metadata } from "next";
import Link from "next/link";
import LearnPageScaffold from "@/components/LearnPageScaffold";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

export const metadata: Metadata = {
  title: "How Max Pain Works",
  description:
    "Max Pain is the strike where option holders collectively lose the most at expiration — and where dealer hedging tends to pull spot. Here's how it's calculated, why it matters, and what it doesn't tell you.",
  alternates: { canonical: `${APP_URL}/learn/max-pain` },
  openGraph: {
    type: "article",
    url: `${APP_URL}/learn/max-pain`,
    title: "How Max Pain Works",
    description:
      "The OI-weighted pin strike, why dealers pull price toward it, and the limits of the theory.",
  },
};

export default function Page() {
  return (
    <LearnPageScaffold
      title="How Max Pain Works"
      lead="Max Pain is the strike price at which the total payout to option holders is minimized at expiration. Equivalently, it's the strike that maximizes premium retained by option sellers — typically dealers. The theory predicts that price tends to gravitate toward Max Pain into expiration as dealer hedging pulls it there."
      slug="max-pain"
      faqs={[
        {
          question: "What is Max Pain in options trading?",
          answer:
            "Max Pain is the strike price at which the aggregate intrinsic value of all in-the-money options across the chain is minimized at expiration. Because option sellers (mostly market makers and dealers) are short most of that open interest, the Max Pain strike is also where they collectively lose the least. The pinning effect describes the tendency for spot price to drift toward Max Pain as expiration approaches.",
        },
        {
          question: "Is Max Pain reliable for predicting where a stock will close?",
          answer:
            "It's a tendency, not a guarantee. Pinning works best for stocks with deep, concentrated open interest near current spot (like SPX on monthly OPEX). It breaks down on event-driven days (earnings, FOMC, CPI prints), low-volume sessions, or when fundamental news overwhelms positioning. Treat Max Pain as one input among several, not as a price target.",
        },
        {
          question: "Why does dealer hedging cause pinning?",
          answer:
            "Dealers who sold options need to stay delta-neutral. When spot rises toward a high-OI call strike, dealers (short those calls) have to sell underlying to hedge. When spot falls toward a high-OI put strike, they buy. The net effect is a damping force — buy low, sell high — that pulls price toward the strike with the most open interest. This works mechanically when dealers are net long gamma (positive GEX); it inverts when they're net short gamma (negative GEX). See our <a href='/learn/gamma-exposure'>GEX explainer</a>.",
        },
        {
          question: "How is Max Pain calculated?",
          answer:
            "For each candidate strike, sum the dollar value option holders would receive at expiration if spot closed there. Calls pay (strike − spot) × OI for each strike below spot; puts pay (spot − strike) × OI for each strike above. Add the call payouts and put payouts at every candidate strike, then find the strike where the total is minimized — that's Max Pain. The 0DTE Market Research scanner runs this calculation per ticker, per expiration, every day.",
        },
        {
          question: "What's the difference between Max Pain and Gamma Exposure?",
          answer:
            "Max Pain answers 'where do options expire if I want to maximize seller P&L?' — it's about open interest. Gamma Exposure (GEX) answers 'how aggressively will dealers hedge if price moves 1%?' — it's about gamma weighting. They often agree on which strikes matter, but the framing differs: Max Pain is a static end-of-day target, GEX is a dynamic flow rate.",
        },
      ]}
      related={[
        { slug: "gamma-exposure", title: "Gamma Exposure (GEX) Explained" },
        { slug: "0dte-options", title: "What is 0DTE Options Trading?" },
        { slug: "polymarket-whales", title: "Polymarket Whale Tracking" },
      ]}
    >
      <h2>The intuition behind Max Pain</h2>
      <p>
        Imagine SPY closes expiration day at $500. Every $500-strike call expires
        worthless (zero intrinsic). Every $500-strike put expires worthless. Every
        ITM option pays out — calls below $500, puts above $500 — and the holders
        of those options collect from the sellers.
      </p>
      <p>
        For a given closing price, you can compute the total dollar payout to
        option holders across the entire chain. Some prices produce small total
        payouts (close to ATM with shallow OI on each side); other prices produce
        large payouts (e.g., far below current spot where lots of long puts are
        struck). <strong>Max Pain is the price that minimizes the total payout</strong>
        — the closing level where option holders collectively get the worst
        outcome.
      </p>
      <p>
        Since the natural counterparty to options is option sellers (dealers,
        market makers, institutional writers), Max Pain is equivalently the
        price that maximizes seller P&amp;L. It&apos;s the "where do the sellers
        want spot to land?" question, answered by the open-interest distribution.
      </p>

      <h2>How dealer hedging pulls price toward Max Pain</h2>
      <p>
        The mechanism that makes pinning real (not just a curiosity) is dealer
        delta-hedging. Dealers don&apos;t want directional exposure — they want to
        capture the bid-ask spread on options without taking a view on spot. To
        stay neutral, they continuously buy or sell the underlying to offset the
        delta of their open option book.
      </p>
      <p>When spot moves <strong>up</strong> toward a high-OI call strike:</p>
      <ul>
        <li>The calls dealers are short become more delta-positive (deeper ITM).</li>
        <li>Dealers must sell underlying to offset the new long delta.</li>
        <li>That selling absorbs upward pressure → slows the move.</li>
      </ul>
      <p>When spot moves <strong>down</strong> toward a high-OI put strike:</p>
      <ul>
        <li>The puts dealers are short become more delta-negative.</li>
        <li>Dealers must buy underlying to offset the new short delta.</li>
        <li>That buying absorbs downward pressure → slows the move.</li>
      </ul>
      <p>
        The net effect is a damping force around Max Pain. Move too far in either
        direction and dealer flows push you back. The strike with the largest
        net dealer short-gamma position is also the most-pinned strike. This is
        why the high-OI Fridays show such clear "magnet" behavior in indices.
      </p>

      <h2>When pinning works and when it breaks</h2>

      <h3>Pinning works well when:</h3>
      <ul>
        <li>
          <strong>Open interest is large and concentrated</strong> near current
          spot. Sparse OI = weak pin.
        </li>
        <li>
          <strong>The day is data-light and dealer-flow-dominated.</strong>{" "}
          Calm Friday afternoons in indices are the prototype.
        </li>
        <li>
          <strong>Dealers are net long gamma</strong> (positive GEX regime).
          Their hedging is damping; pinning is the natural consequence.
        </li>
      </ul>

      <h3>Pinning breaks when:</h3>
      <ul>
        <li>
          <strong>News overwhelms positioning.</strong> Fed surprise, geopolitical
          shock, earnings beat — any large directional impulse swamps dealer
          hedging.
        </li>
        <li>
          <strong>Dealers are short gamma</strong> (negative GEX regime). Their
          hedging amplifies moves instead of dampening them; pin breaks become
          accelerations.
        </li>
        <li>
          <strong>Spot is already far from any meaningful OI cluster.</strong>{" "}
          When the nearest big strike is 2% away, the pinning force is too weak
          to matter intraday.
        </li>
        <li>
          <strong>Liquidity is thin</strong>. Overnight gaps, premarket prints,
          and the first 15 minutes of trading can blow through Max Pain easily.
        </li>
      </ul>

      <h2>Reading Max Pain alongside spot</h2>
      <p>
        The most useful read is the <strong>distance and direction</strong> from
        spot to Max Pain. A few common scenarios:
      </p>
      <ul>
        <li>
          <strong>Spot within 0.5% of Max Pain, high OI, calm day</strong> → expect
          a tight intraday range that drifts toward Max Pain into the close.
          Premium-selling setups (iron condors, butterflies) work here.
        </li>
        <li>
          <strong>Spot 1–2% above Max Pain</strong> → there&apos;s a downward
          pull, but it&apos;s muted unless dealer positioning supports it. Check
          the call walls along the way.
        </li>
        <li>
          <strong>Spot 1–2% below Max Pain</strong> → upward pull. The put walls
          on the downside often act as support; a clean break of them can
          accelerate.
        </li>
        <li>
          <strong>Spot &gt; 3% from Max Pain</strong> → the level is mostly
          irrelevant for today. Trade off other primitives.
        </li>
      </ul>

      <h2>What Max Pain doesn't tell you</h2>
      <p>
        Max Pain describes <em>where</em> dealer positioning is concentrated. It
        doesn&apos;t tell you:
      </p>
      <ul>
        <li>
          <strong>Why</strong> open interest accumulated there. Could be hedging
          flows, directional bets, structured products — different sources
          produce different intraday behavior.
        </li>
        <li>
          <strong>Whether dealers are long or short gamma</strong>. That requires
          a per-strike calculation. See <Link href="/learn/gamma-exposure">GEX</Link>.
        </li>
        <li>
          <strong>How fast</strong> price would react to a flow imbalance. GEX
          is the velocity primitive; Max Pain is the location primitive.
        </li>
      </ul>
      <p>
        The 0DTE Market Research Max Pain scanner publishes the daily snapshot
        for SPX, SPY, QQQ, and ~20 single names. It includes the front-month
        Max Pain strike, percent distance from spot, the per-expiration
        breakdown, and HIGH/MED/LOW alerts when the level migrates materially
        between scans.
      </p>
    </LearnPageScaffold>
  );
}
