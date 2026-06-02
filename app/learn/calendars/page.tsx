import type { Metadata } from "next";
import LearnPageScaffold from "@/components/LearnPageScaffold";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

export const metadata: Metadata = {
  title: "Reading Calendars — High-Probability Calendar Spread Ranker",
  description:
    "Every Sunday, Calendars ranks the highest-probability long-calendar spread opportunities across a locked ~50-ticker large-cap universe. Filters: IV rank ≥ 60%, no earnings in next 30 days, front IV ≥ back IV. Ranking blends IV rank, term structure, post-earnings timing, and DTE quality.",
  alternates: { canonical: `${APP_URL}/learn/calendars` },
  openGraph: {
    type: "article",
    url: `${APP_URL}/learn/calendars`,
    title: "Reading Calendars — High-Probability Calendar Spread Ranker",
    description:
      "How the scanner picks calendars: ATM strike, ~30 DTE front + ~90 DTE back, IV-rank gated, earnings-cleared, ranked by composite score.",
  },
};

export default function Page() {
  return (
    <LearnPageScaffold
      title="Reading Calendars — High-Probability Calendar Spread Ranker"
      lead="Every Sunday the Calendar scanner walks a locked universe of ~50 liquid large-cap US equities. For each ticker that clears the filters (IV rank ≥ 60%, no earnings in next 30 days, favorable term structure), it constructs a long ATM call calendar — sell a ~30 DTE front-month call, buy a ~90 DTE back-month call at the same strike — and ranks it by composite score. The output is a ranked table with one BUILD button per row that drops both legs into Risk Graph."
      slug="calendars"
      faqs={[
        {
          question: "What's a long calendar spread, and why trade it?",
          answer:
            "Sell a near-term option (the front, ~30 DTE) and buy a longer-dated option (the back, ~90 DTE) at the same strike, same type. Net debit because the longer expiry has more time value. Profit comes from two sources: (1) theta — the front decays faster than the back; (2) vega — when realized vol rises, the back's vega is bigger, so the spread expands. The ideal outcome is the stock pinning the strike through front expiry: the front goes worthless, you keep the front's premium, and you're left long the back option at a discount.",
        },
        {
          question: "Why ATM and not OTM?",
          answer:
            "Time decay is fastest at-the-money. An ATM front-month option loses extrinsic value to theta at the maximum rate, which is exactly what you want to harvest. OTM calendars are sometimes used for directional bias (skewed-strike calendars), but the V1 scanner targets pure neutral ATM setups where the math is cleanest.",
        },
        {
          question: "What are the filters?",
          answer:
            "Three hard gates that every pick must clear: (1) Chain availability — both a 20-40 DTE front expiry and a 60-120 DTE back expiry must exist with the same strike listed in both. (2) Earnings clearance — no earnings report in the next 30 days. An unexpected EE inside the front-month window blows up the IV crush dynamic the calendar relies on. (3) IV rank ≥ 60% — front-month options must be statistically expensive vs. the ticker's 1-year IV history. Selling cheap vol on a 30 DTE option destroys the theta harvest. (4) Term structure favorable — front IV ≥ back IV. Front cheaper than back is backwards.",
        },
        {
          question: "How is the composite score computed?",
          answer:
            "Weighted blend of four signals, all on a 0-100 scale: 35% × IV rank (higher = more theta to harvest); 30% × clamp((front_iv / back_iv − 1) × 100, 0..25) — steeper inversion means more time-decay differential to capture; 20% × post-earnings timing bonus (+20 if 5-15 days post-EE — the sweet spot when IV has crushed; +10 if 15-30 days; 0 otherwise); 15% × DTE quality (full marks when front lands on 30 DTE and back on 90 DTE, fading linearly). Sum rounded to an integer, color-coded emerald (≥70 strong), amber (40-69 ok), rose (<40 marginal).",
        },
        {
          question: "Why is post-earnings timing a sweet spot?",
          answer:
            "When a stock reports, IV crushes hard the next session — implied vol on the front month drops 30-60% in hours. That makes the front cheap relative to its own history AND relative to longer-dated options (which crushed less). The 5-15 day window after EE captures the period when IV has settled at a lower level but the term structure hasn't fully normalized — front still relatively cheap vs. back. Calendars opened here have built-in IV-mean-reversion as tailwind.",
        },
        {
          question: "What's the 'TS ratio' column?",
          answer:
            "Term Structure Ratio = front_iv / back_iv. > 1.0 means the front is more expensive than the back (favorable for calendar). > 1.15 (15% premium) means materially steep — that's why the scanner colors it emerald-bold. Most healthy calendar setups land in the 1.05-1.20 range. Below 1.0 the trade goes the wrong way and the scanner rejects it.",
        },
        {
          question: "Why front 20-40 DTE and back 60-120 DTE?",
          answer:
            "Front 20-40: theta acceleration peaks in this window. Selling a 5-DTE option exposes you to too much gamma; selling a 60-DTE option doesn't decay fast enough. The 30-day sweet spot is what professional calendar traders target. Back 60-120: needs to be far enough past the front to retain meaningful time value after the front expires (rule of thumb: at least 30 days gap). 60-90 days is the typical back-month choice; 120 max because beyond that the IV-rank signal loses correlation with realistic vega expansion.",
        },
        {
          question: "Why no earnings in next 30 days?",
          answer:
            "A scheduled earnings report inside the front-month window does two things, both bad for a calendar. (1) IV spike — front-month IV ramps into the report, then crushes after. If you're short the front, that's actually good — but the post-EE move can blow through your breakevens. (2) Big realized move — if the stock moves +/-5% on the report, you're far from the strike and the calendar is worth pennies. The 30-day clearance ensures the trade plays out in a normal vol regime, not an event regime. For event-driven plays, use Earnings Scans instead.",
        },
        {
          question: "How should I size and exit?",
          answer:
            "Size by your max-loss tolerance: the most you can lose on a long calendar is the net debit (rare in practice — requires the front and back to both go to zero, which doesn't happen). Typical max loss is 30-50% of debit. Position size 1-2% of buying power per pick is reasonable. Exit: most calendars are closed before front expiry, ideally when the front has decayed 50-70% (usually 7-10 days before front expiration). Holding into front expiry exposes you to assignment risk if the stock is near the strike — close it. If the stock moves far from the strike, close early — the back's time value is decaying too.",
        },
        {
          question: "What about reverse calendars (sell back, buy front)?",
          answer:
            "Reverse calendars profit from rapid vol expansion or sudden gamma explosions — the OPPOSITE of what a long calendar plays. The V1 scanner only ranks long calendars; reverse calendars are situational (e.g., right before a known catalyst) and don't fit the IV-rank-gated screen. If you want to play vol expansion systematically, look at Earnings Rush instead.",
        },
        {
          question: "What's the universe?",
          answer:
            "Same as Sell Puts — 53 liquid large/mega-cap US equities + index ETFs. Curated for active weekly + monthly chains, tight bid-ask spreads, and well-behaved IV surfaces (no meme-stock vol smiles). Black-Scholes-derived term-structure ratios work cleanly on these names. Recent IPOs and thin names are intentionally excluded — calendar spreads on illiquid chains can't be exited cleanly.",
        },
        {
          question: "Why isn't every ticker on the page?",
          answer:
            "Each ticker can only show up when ALL filters pass. Common skip reasons: 'No back expiry' (smaller names list only quarterly options past 60 days); 'IV rank too low' (current IV not in the top 40% of 1y range — selling cheap vol doesn't work); 'Earnings in window' (next EE within 30 days); 'Term structure unfavorable' (front IV < back IV — calendar mechanics broken); 'No IV rank' (ticker not in the iv_snapshots watchlist, so we can't gauge whether vol is expensive). Skipped tickers are kept in the persisted scan for diagnostic visibility but excluded from the page table.",
        },
        {
          question: "When does the scan run?",
          answer:
            "Sunday 23:30 UTC (6:30/7:30 PM ET) — after Sell Puts at 23:00 and Earnings Scans at 22:00, in the same Sunday-evening planning window. Manual triggers go through /api/cron/calendar-scan with the CALENDAR_CRON_TOKEN bearer. Total runtime ~4-5 min for the 53-name universe (chain fetch + earnings calendar lookup + IV-rank DB query per ticker).",
        },
        {
          question: "What's coming in V2?",
          answer:
            "Historical backtest, same way Earnings Scans gained it. For each candidate the scanner will simulate the last 6-12 calendar trades on that name (rolling monthly entries), compute actual P&L using Polygon contract aggregates, and report Win % / Avg ROI / per-cycle sparkline. Confidence tiering (STRONG/WEAK/THIN by sample size) plus an analyst layer hero box will follow.",
        },
      ]}
      related={[
        { slug: "sell-puts", title: "Reading Sell Puts" },
        { slug: "earnings-scans", title: "Reading Earnings Scans" },
        { slug: "risk-graph", title: "Building a Risk Graph" },
      ]}
    >
      <h2>The strategy in two paragraphs</h2>
      <p>
        A long calendar spread is a bet on TIME — specifically, that the
        near-term option will decay faster than the longer-dated one.
        You sell a ~30 DTE option (the front, the &ldquo;short&rdquo;
        leg) and buy a ~90 DTE option at the same strike and same type
        (the back, the &ldquo;long&rdquo; leg). You pay a net debit
        because the longer expiry has more extrinsic value. Profit
        accrues two ways: theta differential (the front decays faster)
        and vega differential (if IV rises, the back gains more than
        the front loses).
      </p>
      <p>
        The ideal scenario is the underlying pinning the strike through
        front expiry. The front goes worthless, you pocket its premium,
        and you&apos;re left long a 60-DTE option at a meaningful
        discount. From there you can sell it outright, or roll into a
        new short front to start the next leg of a wheel. Calendars are
        a workhorse strategy for sideways-with-vol-expansion regimes:
        you collect theta while waiting for the back-month vega to
        re-rate.
      </p>

      <h2>How to use this page</h2>
      <ol>
        <li>
          <strong>Sunday night / Monday morning:</strong> check the
          ranked table. Composite score ≥ 60 (emerald) is the
          actionable zone.
        </li>
        <li>
          <strong>Pull the chart</strong> for the top 2-3 picks.
          Verify the ATM strike lines up with a clean horizontal level
          — support if the stock has been bouncing, resistance if
          it&apos;s been topping. Calendars work best on
          range-bound names; a stock about to break out of consolidation
          ruins the math.
        </li>
        <li>
          <strong>Hit BUILD</strong> to drop both legs into Risk Graph.
          Verify the actual chain prices match the scanner&apos;s
          estimates and that the spread is achievable at a reasonable
          debit.
        </li>
        <li>
          <strong>Open positions with 1-2 weeks of cushion</strong> on
          the front — i.e., open with front DTE ≥ 25 so you have time
          for the trade to develop before front expiry forces a
          decision.
        </li>
        <li>
          <strong>Manage exit:</strong> close when front is at 50-70%
          theta decay (7-10 days pre-expiry), or earlier if the stock
          breaks out from the strike, or earlier if vol crashes
          dramatically (the back has decayed too).
        </li>
      </ol>

      <h2>What the scanner intentionally doesn&apos;t do (yet)</h2>
      <ul>
        <li>
          <strong>No chart confirmation.</strong> The scanner picks ATM
          strikes mathematically; you still need to verify the strike
          aligns with a clean support/resistance level. A calendar at
          $150 strike when the chart says $150 is &ldquo;in the middle
          of nowhere&rdquo; is statistically fine but technically weak.
        </li>
        <li>
          <strong>No historical backtest.</strong> V1 ranks current
          setups by point-in-time signals. V2 will add per-name
          historical simulation (&ldquo;how did calendars work on this
          ticker the last 6 times you could have entered one&rdquo;)
          same as Earnings Scans got.
        </li>
        <li>
          <strong>No regime overlay.</strong> The composite score
          doesn&apos;t consider whether the broader market is in a
          high-vol or low-vol regime — calendars work better in
          steady-vol environments than in extremes. Cross-check against
          VIX and Options Edge before sizing up.
        </li>
      </ul>
    </LearnPageScaffold>
  );
}
