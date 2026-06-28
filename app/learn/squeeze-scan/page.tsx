import type { Metadata } from "next";
import LearnPageScaffold from "@/components/LearnPageScaffold";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

export const metadata: Metadata = {
  title: "Reading Squeeze Scan — ST Squeeze Ultra (Daily + Weekly)",
  description:
    "Every Sunday, Squeeze Scan runs the ST Squeeze Ultra engine — Bollinger Bands compressing inside Keltner Channels — over every optionable US stock priced $20+ with daily volume over 500,000. It flags which names are in a squeeze on the Daily and Weekly timeframes, how tight the coil is (Wide / Mid / Tight), whether it's an 'ideal' stacked-EMA setup, and which way momentum is leaning. Here's how to read every signal.",
  alternates: { canonical: `${APP_URL}/learn/squeeze-scan` },
  openGraph: {
    type: "article",
    url: `${APP_URL}/learn/squeeze-scan`,
    title: "Reading Squeeze Scan — ST Squeeze Ultra (Daily + Weekly)",
    description:
      "Squeeze state (Wide/Mid/Tight), the ideal stacked-EMA flag, the four momentum colours, Daily vs Weekly, and how the weekly full-market scan finds compressing stocks.",
  },
};

export default function Page() {
  return (
    <LearnPageScaffold
      title="Reading Squeeze Scan — ST Squeeze Ultra (Daily + Weekly)"
      lead="Squeeze Scan is a weekly full-market run of the ST Squeeze Ultra indicator — a port of the Simpler Trading ThinkScript study, verified bar-for-bar against the reference engine. A 'squeeze' is when volatility compresses: the Bollinger Bands pull inside the Keltner Channels, meaning price is coiling and energy is building for an eventual expansion. The scan pulls roughly a year of daily bars for every optionable US stock priced $20+ with daily volume over 500,000, runs the engine on the Daily series and on resampled Weekly bars, and lists every name in a squeeze on either timeframe — sorted so the cleanest 'ideal' setups and the tightest coils sit at the top."
      slug="squeeze-scan"
      faqs={[
        {
          question: "What is a squeeze, exactly?",
          answer:
            "A squeeze is a volatility-compression signal. You overlay Bollinger Bands (which widen and narrow with standard deviation) on Keltner Channels (which widen and narrow with average true range). When the Bollinger Bands contract all the way INSIDE the Keltner Channels, volatility has dropped to an unusual low — price is consolidating in a tight range. That compression tends to resolve in a sharp directional move once it releases. The squeeze tells you energy is building; it does not tell you which direction it will fire.",
        },
        {
          question: "What do Wide / Mid / Tight mean?",
          answer:
            "They're the depth of the squeeze — how far inside the Keltner Channels the Bollinger Bands have pulled. The engine checks three Keltner widths (2.0×, 1.5×, and 1.0× ATR). Wide (state 1) = bands inside the 2.0× channel — a mild squeeze just forming. Mid (state 2) = inside the 1.5× channel — a developed squeeze. Tight (state 3) = inside the 1.0× channel — the tightest coil, maximum compression. Tighter generally means a more wound-up spring, closer to release. The scan sorts tightest-first within each ideal tier.",
        },
        {
          question: "What makes a squeeze 'ideal' (↑ and ↓)?",
          answer:
            "Ideal ↑ is the engine's high-quality LONG setup: the 8-, 13-, and 21-period EMAs are stacked bullishly (EMA8 > EMA13 > EMA21), the 13 and 21 EMAs are both rising, AND the name is in a Mid-state squeeze (state 2) specifically — a developed squeeze forming inside a clean rising uptrend, the textbook continuation entry. Ideal ↓ is the exact mirror for SHORTS: EMAs stacked down (EMA8 < EMA13 < EMA21) and falling, with a Mid-state squeeze — a coil inside a clean downtrend. Both require state 2 exactly (not 1 or 3) by design, get a coloured badge (green ↑ / red ↓), and sort to the top of the table.",
        },
        {
          question: "What is the AI analysis on the top 3 setups?",
          answer:
            "Each week, the cleanest ideal setups (long or short, preferring names where Daily and Weekly agree and the coil is tightest) get a short read written by Claude (Opus 4.8) at scan time — never on page load. It gives a directional call (LONG / SHORT / NEUTRAL) for the likely release, a conviction level, a 'why' grounded in the squeeze tightness + momentum colour + timeframe alignment, and an honest risk note (a squeeze can release either way). Alongside it, the scan pulls a ~25–50 DTE options chain and builds a concrete defined-risk debit spread in the AI's direction — a call debit spread for long, a put debit spread for short — with strikes, net debit, max profit/loss, breakeven, and a one-click Risk Graph deep-link. The AI can disagree with the indicator's bias and call neutral when momentum conflicts.",
        },
        {
          question: "What do the momentum colours mean?",
          answer:
            "The small second dot is the TTM-style momentum oscillator's direction, in the original study's four-colour scheme. Cyan = positive and rising (up-momentum accelerating). Blue = positive but falling (up-momentum fading). Yellow = negative but rising (down-momentum improving — a possible turn). Red = negative and falling (down-momentum accelerating). On an ideal long setup you generally want to see cyan or yellow (momentum turning up), not red.",
        },
        {
          question: "Why both Daily and Weekly?",
          answer:
            "Timeframe alignment is the whole game with squeezes. A Daily squeeze is a swing-trade signal — it can fire within days. A Weekly squeeze is a much bigger, slower coil that can drive multi-week-to-multi-month moves. A name squeezing on BOTH timeframes, especially with weekly momentum turning up, is the highest-conviction setup because the short-term and long-term compression agree. The table shows each timeframe side by side so you can spot that alignment at a glance; the filter chips let you isolate Daily-only or Weekly-only.",
        },
        {
          question: "How are the weekly bars built?",
          answer:
            "From the daily bars, resampled by ISO week (Monday–Friday): the week's open is the first day's open, the high is the week's max, the low is the week's min, the close is the last day's close. The engine then runs on that weekly series exactly as it does on the daily series — same length (21), same Bollinger/Keltner math, same momentum and ideal logic. Pulling roughly a year of dailies gives ~58 weekly bars, comfortably past the indicator's warmup.",
        },
        {
          question: "What's the universe?",
          answer:
            "Every US stock in the Polygon market snapshot that (a) is priced $20 or more, (b) traded more than 500,000 shares that day, and (c) is a common stock or ADR (which filters out leveraged/inverse ETFs and ETNs). That last filter is a practical proxy for 'optionable, real company' — the same gate the Premium Ranker uses. It yields roughly 1,500–2,500 names to deep-scan each week.",
        },
        {
          question: "Why is the engine a 'port', and can I trust it matches?",
          answer:
            "The math is ported from the Simpler Trading ST_SqueezeUltra ThinkScript into a Python reference engine, then into the TypeScript that runs on this site. The TypeScript port is checked bar-for-bar against the Python reference on a battery of synthetic price series (random walks, tight-then-expansion, accelerating trends, choppy ranges) — over a thousand bars, every state / momentum / colour / ideal flag matches. Calibration detail: the Bollinger basis uses an EMA and population standard deviation, matching ThinkScript's defaults.",
        },
        {
          question: "How should I use the scan?",
          answer:
            "As a watchlist builder, not a trigger. The squeeze tells you WHERE energy is compressing; you still need your own entry trigger (a breakout, a momentum flip to cyan, a level reclaim) and a risk plan. Start with the ideal-flagged names where Daily and Weekly agree and momentum is turning up. Remember a squeeze can release in either direction — pair it with the stock's trend, the broader tape, and any upcoming catalyst before committing.",
        },
        {
          question: "When does the scan run?",
          answer:
            "Sunday evening (UTC), via the SQUEEZE_ULTRA_CRON_TOKEN-protected /api/cron/squeeze-ultra-scan endpoint. It pulls one market snapshot, then one daily-bars call per survivor at bounded concurrency — a couple of minutes end to end. One row is stored per scan day; the page always shows the latest.",
        },
      ]}
      related={[
        { slug: "options-edge", title: "Reading Options Edge (IV rank)" },
        { slug: "premium-ranker", title: "Reading Premium Ranker" },
        { slug: "risk-graph", title: "Building a Risk Graph" },
      ]}
    >
      <h2>The idea in one paragraph</h2>
      <p>
        Markets alternate between coiling (low volatility, tight range) and
        firing (high volatility, trending). A squeeze catches the coil: when
        the Bollinger Bands compress inside the Keltner Channels, the stock is
        quietly winding up a spring. Squeeze Scan finds every optionable, liquid
        $20+ name doing that right now — on the Daily and Weekly timeframes —
        and ranks the cleanest, tightest, trend-aligned coils to the top so you
        can build a watchlist of stocks most likely to make a big move soon.
      </p>

      <h2>What each row shows</h2>
      <ul>
        <li>
          <strong>Ticker / Price / Volume</strong> — the name, spot, and the
          day&apos;s share volume (the liquidity gate it cleared).
        </li>
        <li>
          <strong>Daily</strong> — the squeeze read on daily bars: a coloured
          state dot (orange Tight / red Mid / grey Wide), the state label, an{" "}
          <em>IDEAL</em> badge when the stacked-EMA setup is present, and a
          momentum dot (cyan / blue / yellow / red).
        </li>
        <li>
          <strong>Weekly</strong> — the same read on weekly bars. A name lit up
          on both columns is the strongest alignment.
        </li>
      </ul>

      <h2>Reading the two dots</h2>
      <ul>
        <li>
          <strong>State dot (bigger)</strong> — how tight the squeeze is. Orange
          = Tight (most compressed), red = Mid, grey = Wide (just forming).
        </li>
        <li>
          <strong>Momentum dot (smaller)</strong> — direction + slope of the
          oscillator. Cyan = up &amp; accelerating, blue = up &amp; fading,
          yellow = down &amp; improving, red = down &amp; accelerating.
        </li>
      </ul>

      <h2>What the scan intentionally doesn&apos;t do</h2>
      <ul>
        <li>
          <strong>It doesn&apos;t predict direction.</strong> A squeeze is a
          compression signal, not a buy or sell signal. The release can go
          either way — the ideal flag and momentum colour hint at the bias, but
          they&apos;re not a guarantee.
        </li>
        <li>
          <strong>It doesn&apos;t time the release.</strong> Squeezes can stay
          coiled for many bars. Tighter (orange) tends to be later-stage, but
          there&apos;s no countdown — that&apos;s what your entry trigger is for.
        </li>
        <li>
          <strong>It isn&apos;t advice.</strong> Use it to build a watchlist,
          then apply your own confirmation, position sizing, and risk plan.
        </li>
      </ul>
    </LearnPageScaffold>
  );
}
