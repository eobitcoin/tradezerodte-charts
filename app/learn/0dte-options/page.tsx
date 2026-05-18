import type { Metadata } from "next";
import Link from "next/link";
import LearnPageScaffold from "@/components/LearnPageScaffold";

const APP_URL = process.env.APP_URL || "https://www.tradezerodte.com";

export const metadata: Metadata = {
  title: "What is 0DTE Options Trading?",
  description:
    "0DTE means zero days to expiration — options that expire the same day. Here's why theta is brutal, gamma is enormous, and position sizing matters more than direction.",
  alternates: { canonical: `${APP_URL}/learn/0dte-options` },
  openGraph: {
    type: "article",
    url: `${APP_URL}/learn/0dte-options`,
    title: "What is 0DTE Options Trading?",
    description:
      "Same-day expiration explained: theta dynamics, gamma magnitude, and why size discipline is non-negotiable.",
  },
};

export default function Page() {
  return (
    <LearnPageScaffold
      title="What is 0DTE Options Trading?"
      lead="0DTE — “zero days to expiration” — refers to option contracts that expire the same trading day they’re bought or sold. SPX, SPY, QQQ, NDX, and a growing list of single-name tickers offer daily expirations, making 0DTE a distinct trading style rather than just a quirk of monthly OPEX Fridays."
      slug="0dte-options"
      faqs={[
        {
          question: "Why do traders use 0DTE options?",
          answer:
            "Same-day options offer large dollar moves on small premium outlays — leverage that's hard to get elsewhere. They're also the cleanest way to express a view on an intraday catalyst (CPI print, FOMC decision, earnings reaction) without taking overnight risk. The tradeoff is brutal time decay: a 0DTE option loses essentially all its time value during a single session.",
        },
        {
          question: "What are the biggest mistakes 0DTE traders make?",
          answer:
            "Three repeat offenders: (1) sizing positions as if they were stock — a full loss on a $5 option is 100% of premium, not the modest pullback a stock position would have shown; (2) ignoring time stops — by 2 PM ET a directional bet that hasn't moved is statistically more likely to bleed out than work; (3) chasing into elevated implied volatility on news days, then watching IV crush the position even when direction is right.",
        },
        {
          question: "What's the difference between theta and gamma on 0DTE?",
          answer:
            "Theta is time decay — what the option loses every minute it sits unmoved. Gamma is how fast delta changes when the underlying moves. Both peak at expiration. For 0DTE that means a single small spot move can flip a position from worthless to deeply ITM (high gamma), but every minute you're not in the right position is bleeding (high theta). The two forces fight each other and make 0DTE the most reactive options class.",
        },
        {
          question: "What is dealer gamma and why does it matter for 0DTE?",
          answer:
            "Market makers who sell 0DTE options have to hedge their gamma exposure by buying or selling the underlying — and the closer to expiration, the more aggressively. This dealer hedging dominates intraday tape, especially in the final two hours. It's why you see SPX pin to a strike on Fridays, and why a small breach of a gamma wall can produce an explosive move. See our explainer on <a href='/learn/gamma-exposure'>Gamma Exposure</a> for the mechanics.",
        },
        {
          question: "Can beginners trade 0DTE?",
          answer:
            "It's not the right starting point. The pace doesn't allow learning under fire — losses compound faster than lessons, and the most-common beginner mistake (oversizing) is also the most-expensive. Start with weeklies or longer-dated options to learn structure and Greeks first, then graduate to 0DTE only once you've internalized stop discipline.",
        },
      ]}
      related={[
        { slug: "max-pain", title: "How Max Pain Works" },
        { slug: "gamma-exposure", title: "Gamma Exposure (GEX) Explained" },
        { slug: "polymarket-whales", title: "Polymarket Whale Tracking" },
      ]}
    >
      <h2>What "zero days to expiration" actually means</h2>
      <p>
        Every option contract has an expiration date. When that date is{" "}
        <strong>today</strong>, the option is described as 0DTE. As the day progresses,
        the option&apos;s remaining life is measured in hours, then minutes, then
        seconds. At market close, any 0DTE option that&apos;s out-of-the-money
        expires worthless; in-the-money options auto-exercise (for cash-settled
        index options) or convert to a stock position.
      </p>
      <p>
        Daily expirations existed for index options for years, but the asset class
        exploded after the CBOE started listing them on every weekday in 2022.
        SPX 0DTE now accounts for over 40% of total SPX options volume on a typical
        day. QQQ, SPY, IWM, and many single names (TSLA, NVDA, AAPL, AMD, META)
        now have daily expirations as well.
      </p>

      <h2>Why 0DTE is fundamentally different from other options</h2>

      <h3>Theta is brutal</h3>
      <p>
        Time decay isn&apos;t a slow drain on 0DTE — it&apos;s the dominant force.
        An at-the-money 0DTE option that&apos;s worth $5 at 9:30 AM might be worth
        $1 by 2:00 PM even if the underlying hasn&apos;t moved. The math is
        unforgiving: when time-to-expiration approaches zero, time value approaches
        zero. Buying premium on 0DTE is a bet that the directional move will arrive
        <em> faster</em> than theta erases the position.
      </p>
      <p>
        The implication: <strong>holding through a flat market is a guaranteed
        loss</strong>. This is why time stops — explicit "if I&apos;m not at T1 by
        2:30 PM, I close" rules — are mandatory, not optional, on same-day expiry.
      </p>

      <h3>Gamma is enormous</h3>
      <p>
        Gamma measures how fast delta changes when the underlying moves. On 0DTE,
        gamma peaks at the at-the-money strike near close — a $1 move in SPY can
        change the option&apos;s delta from 0.40 to 0.80 in minutes. That&apos;s why
        wins compound fast on 0DTE: a small directional move can take a
        slightly-out-of-the-money option from worthless to deep ITM. But it also
        means losses compound just as fast.
      </p>
      <p>
        Position sizing matters more than direction calls. A correctly-sized 0DTE
        trade can give you huge percentage returns; an oversized one can blow up
        an account on a single bad day. The reverse — "I only made 30% on a 0DTE
        that went my way because I sized too small" — never killed anyone.
      </p>

      <h3>Dealer hedging dominates intraday tape</h3>
      <p>
        Market makers who sell 0DTE options absorb enormous open gamma exposure.
        To stay delta-neutral, they have to buy or sell the underlying as price
        moves — and the closer to expiration, the more aggressively. This
        mechanical hedging produces three observable effects:
      </p>
      <ul>
        <li>
          <strong>Pinning</strong>: stocks gravitate toward strikes with heavy
          open interest, especially on Friday afternoons. Dealer hedging
          dampens moves around the high-OI strike.
        </li>
        <li>
          <strong>Gamma walls</strong>: very large concentrations of dealer
          short-gamma above or below spot act as resistance/support. When
          they&apos;re breached, dealers have to scramble to re-hedge, often
          producing acceleration moves.
        </li>
        <li>
          <strong>Negative-gamma regimes</strong>: when dealers are net short
          gamma, their hedging amplifies moves instead of dampening them. Buying
          high, selling low. This is when the biggest intraday extensions happen.
        </li>
      </ul>
      <p>
        Our <Link href="/learn/gamma-exposure">Gamma Exposure (GEX) explainer</Link>{" "}
        goes deeper on dealer mechanics. And{" "}
        <Link href="/learn/max-pain">Max Pain</Link> covers the pinning effect
        specifically.
      </p>

      <h3>Liquidity windows matter</h3>
      <p>
        0DTE liquidity isn&apos;t uniform across the day. The bulk of volume
        clusters in the first hour after open and the final ninety minutes before
        close — those are when you can get filled tight to mid. Midday on a quiet
        session, spreads widen and the orderbook thins. If you&apos;re trading 0DTE
        in size, plan entries and exits around the liquidity windows.
      </p>

      <h2>A simple framework for evaluating 0DTE setups</h2>
      <p>
        Every 0DTE trade plan needs five things, explicitly:
      </p>
      <ol>
        <li>
          <strong>Direction</strong>: call, put, long, or short — what view is
          this expressing?
        </li>
        <li>
          <strong>Entry zone or trigger</strong>: a price range or condition
          that says "the setup is now live." Chasing through the entry zone is
          a textbook 0DTE loser.
        </li>
        <li>
          <strong>Targets (T1, T2)</strong>: take partials at T1, let the rest
          run to T2. T1 is "high probability"; T2 pays for the losers.
        </li>
        <li>
          <strong>Hard stop</strong>: a price or condition that says the thesis
          is wrong. Honor it. The sample of stop-then-reverse trades looks like
          a pattern, but the sample of ignored stops includes the trades that
          erase accounts.
        </li>
        <li>
          <strong>Time stop</strong>: when do you exit if neither target nor
          stop has hit? Mandatory on 0DTE. Theta will close the position for
          you, badly, if you don&apos;t.
        </li>
      </ol>

      <h2>Who should not trade 0DTE</h2>
      <p>Three groups, honestly:</p>
      <ul>
        <li>
          Anyone who hasn&apos;t yet internalized stop discipline on slower
          options trades. 0DTE rewards mechanical execution; a trader who
          rationalizes ignoring stops in weeklies will accelerate that habit
          into account-destroying behavior on 0DTE.
        </li>
        <li>
          Anyone who can&apos;t actually be at a screen during the trading
          session. 0DTE positions need active management — they aren&apos;t
          "set a stop and walk away" trades.
        </li>
        <li>
          Anyone using their rent money. Same-day options can produce 100%+
          gains, but they can produce 100% losses just as fast. Risk capital
          only, never living expenses.
        </li>
      </ul>
    </LearnPageScaffold>
  );
}
