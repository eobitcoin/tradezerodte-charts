import type { Metadata } from "next";
import Link from "next/link";
import LearnPageScaffold from "@/components/LearnPageScaffold";

const APP_URL = process.env.APP_URL || "https://www.tradezerodte.com";

export const metadata: Metadata = {
  title: "Polymarket Whale Tracking",
  description:
    "Polymarket settles every trade on-chain, so wallet activity is fully observable. Here's how composite scoring works, what convergence signals mean, and the caveats.",
  alternates: { canonical: `${APP_URL}/learn/polymarket-whales` },
  openGraph: {
    type: "article",
    url: `${APP_URL}/learn/polymarket-whales`,
    title: "Polymarket Whale Tracking",
    description:
      "Composite scoring formula, convergence signals, and what they actually tell you.",
  },
};

export default function Page() {
  return (
    <LearnPageScaffold
      title="Polymarket Whale Tracking"
      lead="Polymarket settles every prediction-market trade on Polygon — every position, every wallet, every fill is publicly observable on-chain. That transparency lets us rank wallets by historical PnL and surface signals when high-scoring wallets converge on the same bet."
      slug="polymarket-whales"
      faqs={[
        {
          question: "What is Polymarket whale tracking?",
          answer:
            "It's the practice of monitoring large-size trades and historical performance of individual Polymarket wallets to identify which traders have demonstrated edge. Because the platform settles on-chain, the entire trade history of every wallet is public — making it possible to score wallets by realized PnL, ROI, and sample size, then watch what the highest-scoring ones do in real time.",
        },
        {
          question: "How is a Polymarket trader's score calculated?",
          answer:
            "The composite score formula is: (0.6 × signed log10(|realizedPnL|+1) + 0.4 × clamp(ROI%, ±50)/10) × min(positions/20, 1). In plain terms: 60% weight on PnL (log-scaled so whales-by-bankroll don't dominate), 40% weight on ROI (capped to prevent lucky 10x trades crowning a wallet), all multiplied by a sample-size factor that discounts wallets with fewer than 20 positions. Scores above 1.0 are genuinely strong track records; above 1.5 is rare.",
        },
        {
          question: "What is a convergence signal?",
          answer:
            "When two or more wallets with composite score ≥ 0.5 enter the same Polymarket market on the same outcome within a short window. The reasoning: one whale buying could mean conviction, dumb money, or insider info — you can't tell. But independent high-scorers buying the same side within hours of each other is harder to dismiss as random. They've seen the same opportunity from different starting points. This is the cleanest tradable signal from whale tracking.",
        },
        {
          question: "Does a high score predict future performance?",
          answer:
            "It predicts that the trader's perspective is worth understanding — not that their next trade will be right. Scoring is retrospective. Markets, edge sources, and market participants evolve. Treat scores as 'whose positions are worth examining' rather than 'whose trades to mirror.' The signal lives in the conviction across multiple high-scorers, not in any single trader's call.",
        },
        {
          question: "What are the main caveats of whale tracking?",
          answer:
            "Five worth knowing: (1) Unrealized PnL is reflexive — whales who moved a market 'look profitable' on it; (2) Market-making vs directional confusion — some 'top wallets' capture spread rather than express conviction; (3) Resolution risk — Polymarket markets occasionally settle on technicalities even when the underlying event went the trader's way; (4) Liquidity matters — a signal you can't fill at the visible price isn't actionable; (5) The roster is incomplete — sharp traders below the whale-size threshold ($500+) don't appear on our radar.",
        },
      ]}
      related={[
        { slug: "max-pain", title: "How Max Pain Works" },
        { slug: "gamma-exposure", title: "Gamma Exposure (GEX) Explained" },
        { slug: "0dte-options", title: "What is 0DTE Options Trading?" },
      ]}
    >
      <h2>Why Polymarket is uniquely transparent</h2>
      <p>
        Traditional prediction markets — Kalshi, the old PredictIt — keep
        individual trader activity private. You see aggregate volume and
        prices; you don&apos;t see who&apos;s buying what. Polymarket is
        different: every fill executes through a public smart contract on
        Polygon, an Ethereum layer-2 network. The address that placed each
        trade is public. The current open positions of every wallet are
        public. The realized PnL of every wallet is computable from public
        data.
      </p>
      <p>
        That transparency unlocks an analysis style that doesn&apos;t exist in
        most financial markets: <strong>wallet-level performance scoring</strong>.
        We can identify which addresses have made money, how consistently, and
        across how many markets — then watch what they do next.
      </p>

      <h2>The composite scoring formula</h2>
      <p>
        Naive ranking by raw PnL fails: a wallet with $100M of trading volume
        and $1M PnL has a 1% return, while a wallet with $10K of volume and
        $500 PnL has a 5% return. The second is the better trader; the first
        just had more capital. Ranking by ROI alone fails too: a wallet that
        won one 10x bet and never traded again has an absurd ROI but no
        evidence of repeatable edge.
      </p>
      <p>
        The composite score weighs three factors:
      </p>
      <pre><code>compositeScore = ( 0.6 × signed log10(|realizedPnL|+1)
                 + 0.4 × clamp(ROI%, ±50)/10 )
                × min(positions/20, 1)</code></pre>

      <h3>60% weight on PnL, log-scaled</h3>
      <p>
        A $100K winner counts roughly 5× more than a $1K winner, not 100×.
        Diminishing returns prevent whales-by-bankroll from dominating the
        leaderboard while still rewarding consistent profit-taking. The
        <code>signed log10</code> handles negative PnL symmetrically: consistent
        losers get negative scores.
      </p>

      <h3>40% weight on ROI, capped at ±50%</h3>
      <p>
        Capital efficiency matters — being right on small bets is better than
        being right on large bets with corresponding leverage. But raw ROI
        rewards luck: one 10x bet on a coin-flip event would push a small
        wallet&apos;s ROI to 1000%, crowning a trader with no demonstrated
        repeatability. The ±50% cap keeps ROI honest.
      </p>

      <h3>Sample-size multiplier (positions / 20, capped at 1)</h3>
      <p>
        A wallet with 3 lifetime positions gets 15% of full score. A wallet
        with 20+ gets 100%. This is the key term: without it, a single lucky
        whale would always top the leaderboard. With it, the ranking rewards
        sustained edge over many bets.
      </p>

      <h2>Convergence signals</h2>
      <p>
        The most actionable output of whale tracking isn&apos;t the leaderboard
        itself — it&apos;s <strong>convergence</strong>: when multiple
        high-scoring wallets enter the same market on the same outcome within a
        short window.
      </p>
      <p>
        The reasoning: any individual whale&apos;s bet has alternative
        explanations. They could be:
      </p>
      <ul>
        <li>Trading conviction — they believe they have edge here.</li>
        <li>Hedging another position.</li>
        <li>Acting on insider information that&apos;s actually wrong.</li>
        <li>Wrong but persistent.</li>
      </ul>
      <p>
        With one wallet, you can&apos;t distinguish these cases. With two or
        three independent high-scorers entering the same side within hours of
        each other, the alternative-explanations narrative gets much weaker.
        They&apos;ve each independently arrived at the same conclusion from
        different research starts — that&apos;s the textbook signal of
        information asymmetry leaking into prices.
      </p>
      <p>
        The 0DTE Market Research Polymarket page surfaces convergence as the
        primary signal: ≥2 wallets with score ≥ 0.5, same market + outcome +
        side, within a configurable window, ranked by total USD volume
        committed. Single-wallet "top-scorer buys" are a secondary feed —
        useful but less reliable.
      </p>

      <h2>What whale tracking is good for</h2>
      <p>
        Three use cases, ordered by reliability:
      </p>
      <ol>
        <li>
          <strong>Convergence as a trade trigger</strong>. When three score-1.5
          wallets buy a market YES within 6 hours of each other, that&apos;s an
          information-asymmetry tell that&apos;s hard to ignore.
        </li>
        <li>
          <strong>Cross-market sentiment</strong>. Comparing the same question
          on Polymarket vs Kalshi reveals when populations meaningfully
          disagree, often because of different access constraints (Kalshi
          US-only, Polymarket non-US) or different resolution rules.
        </li>
        <li>
          <strong>Wallet drill-down</strong>. Looking at the open positions of
          a single high-scoring wallet shows you what themes they&apos;re
          currently expressing — useful for idea generation even if
          individual trades aren&apos;t directly copy-tradable.
        </li>
      </ol>

      <h2>What whale tracking won't tell you</h2>
      <ul>
        <li>
          <strong>Whether the scoring is real edge or survivor bias</strong>.
          Out of thousands of wallets, some will have high scores by luck
          alone. The composite formula&apos;s sample-size term helps, but
          doesn&apos;t eliminate it.
        </li>
        <li>
          <strong>When edge stops working</strong>. A wallet that ranked
          highly during 2024 election season may have nothing useful to say
          about a 2026 EU election. Edges decay.
        </li>
        <li>
          <strong>Resolution risk</strong>. Polymarket markets occasionally
          resolve on technicalities — a wallet looking right for weeks can
          lose because of an ambiguous resolution rule.
        </li>
        <li>
          <strong>Liquidity constraints</strong>. A 5¢ spread on a market with
          $500 of depth isn&apos;t a tradable spread. Always check the
          orderbook before sizing.
        </li>
      </ul>

      <p>
        The full Polymarket toolset on 0DTE Market Research includes a live
        whale-trade firehose, the composite leaderboard, convergence signals,
        and wallet-detail drill-down with open positions and PnL history. For
        the underlying mechanics of the dealer-positioning signals that move
        0DTE markets, see <Link href="/learn/gamma-exposure">Gamma Exposure</Link>{" "}
        and <Link href="/learn/max-pain">Max Pain</Link>.
      </p>
    </LearnPageScaffold>
  );
}
