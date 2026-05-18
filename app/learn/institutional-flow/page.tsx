import type { Metadata } from "next";
import LearnPageScaffold from "@/components/LearnPageScaffold";

const APP_URL = process.env.APP_URL || "https://www.tradezerodte.com";

export const metadata: Metadata = {
  title: "13F Institutional Flow — Smart Money Tracking Explained",
  description:
    "How to read SEC 13F filings to detect when hedge funds and Berkshire are quietly accumulating stocks before retail catches on. The 45-day lag, the cluster signal, the quants caveat, and how to weight what you see.",
  alternates: { canonical: `${APP_URL}/learn/institutional-flow` },
  openGraph: {
    type: "article",
    url: `${APP_URL}/learn/institutional-flow`,
    title: "13F Institutional Flow — Smart Money Tracking Explained",
    description:
      "What 13F filings show, how acceleration is measured, and why retail-attention low + smart-money high is the asymmetric setup.",
  },
};

export default function Page() {
  return (
    <LearnPageScaffold
      title="13F Institutional Flow — Smart Money Tracking Explained"
      lead="Every quarter, every investment manager with $100M+ in US equities files a Form 13F with the SEC disclosing what they hold. The data is public, lagged 45 days, and noisy — but cross-referenced across the right set of funds, it tells you where capital is being quietly deployed before headlines catch up. Here's how to read it."
      slug="institutional-flow"
      faqs={[
        {
          question: "What is a 13F filing?",
          answer:
            "Form 13F is a quarterly report that institutional investment managers (hedge funds, pensions, asset managers) with at least $100M in US equity holdings must file with the SEC. It discloses their long US equity positions as of quarter-end. Filings are due within 45 days of quarter-end, so the freshest 13F you can see is up to 45 days stale.",
        },
        {
          question: "Why only long equity holdings — what's missing?",
          answer:
            "13F covers only US-listed long equity positions. It does NOT include: cash, short positions, options puts used as hedges (though raw put holdings sometimes show — that's why filtering out 'PUT' rows matters), foreign equities, derivatives positions, or any liability/leverage info. You're seeing the long book, nothing else.",
        },
        {
          question: "How do you detect 'smart money accumulation'?",
          answer:
            "Compare two consecutive 13F filings for the same fund. A signal involves: (a) multiple funds adding to or opening new positions in the same stock simultaneously — cluster behavior is much stronger than any single buy, (b) aggregate share count increasing meaningfully (≥ 25% Q/Q) across the watchlist, (c) excluding single-fund block buys that distort the picture — except Berkshire, where Buffett block buys ARE the signal.",
        },
        {
          question: "Why filter for low retail attention?",
          answer:
            "The edge is being EARLY. If a stock is already trending on r/wallstreetbets, options call/put OI is heavily skewed, and Google Trends is hot — the smart-money buying is already priced in by the time you see the 13F. The 'institutional acceleration + retail still quiet' combo identifies setups where capital is moving but the move hasn't been amplified by crowd attention yet.",
        },
        {
          question: "Are quant funds (Renaissance, Two Sigma) reliable signal?",
          answer:
            "Less than you'd think. Quant managers trade so heavily intra-quarter that their 13F is a partial snapshot at best — a position they show at quarter-end may have been entered and exited multiple times before that. For thesis-writing, weight slower-moving fundamental managers (Berkshire, Bridgewater, even Citadel's discretionary book) more heavily than the pure-quant filers.",
        },
        {
          question: "Does the 'average entry price' shown reflect what funds actually paid?",
          answer:
            "No — it's an ESTIMATE derived from (filing value ÷ shares held) at quarter-end. If a fund accumulated over multiple quarters at different prices, the estimate is a single blended number that doesn't reflect actual cost basis. Use it to roughly gauge whether the funds are currently in profit or underwater; don't treat it as a precise figure.",
        },
      ]}
      related={[
        { slug: "weekly-research", title: "Weekly Research — How to Read a Setup" },
        { slug: "earnings-whiplash", title: "Earnings Whiplash — Implied vs Realized Vol" },
        { slug: "insider-buys", title: "Reading Insider Buys (SEC Form 4)" },
        { slug: "sector-rotation", title: "Sector Rotation — Leadership Flips" },
        { slug: "polymarket-whales", title: "Polymarket Whale Tracking" },
      ]}
    >
      <h2>The acceleration filter, concretely</h2>
      <p>
        For each ticker held by ANY fund in the watchlist, the scan checks the latest
        and prior 13F filings. A stock qualifies as &quot;accelerating&quot; when:
      </p>
      <ul>
        <li>Net buyers exceed net sellers across the configured funds.</li>
        <li>
          Aggregate share count up ≥ 25% quarter-over-quarter, OR at least 2 funds opened
          a NEW position (zero shares prior → some shares now).
        </li>
        <li>
          Single-fund block buys (one fund owns &gt;80% of the increase) are filtered
          OUT — except Berkshire. Buffett block buys are the signal.
        </li>
        <li>Put-option holdings are excluded — those are hedges, not bullish accumulation.</li>
      </ul>

      <h2>The retail-attention filter, concretely</h2>
      <p>
        Once a name passes acceleration, it has to ALSO look quiet on the retail side. At
        least 2 of these must be true:
      </p>
      <ul>
        <li>30-day Google Trends ≤ 25/100 on both ticker and company name.</li>
        <li>30-day news article count ≤ 15 mainstream-source articles.</li>
        <li>
          Not currently on r/wallstreetbets, StockTwits trending, or any mainstream
          &quot;most active&quot; list.
        </li>
        <li>Options call/put OI ratio &lt; 2.0 (no meme/squeeze setup forming).</li>
      </ul>
      <p>
        If a name is already trending hard on retail venues, it&apos;s dropped. The
        whole edge is being early.
      </p>

      <h2>How to use the output</h2>
      <p>
        Each stock card shows the supporting funds (who added, how much, was it new), the
        retail-attention block (the four metrics above), an avg-entry-price estimate
        (derived from value÷shares), and a thesis explaining WHY these specific managers
        likely added — usually tied to their broader portfolio tilt (e.g., Bridgewater
        adding into a sector consistent with their macro stance).
      </p>
      <p>
        Position sizing + entry timing is your call. Smart-money accumulation is a
        sentiment cross-check, not a market order.
      </p>

      <h2>Honest limits</h2>
      <ul>
        <li>
          <strong>Quarterly resolution.</strong> A 13F shows what a fund held at
          quarter-end. The position may have been entered week 1, week 13, or anywhere
          between. You don&apos;t know.
        </li>
        <li>
          <strong>Smart money is sometimes wrong.</strong> The funds we track produce
          long-term alpha but lose money on individual positions all the time.
        </li>
        <li>
          <strong>Time horizon matters.</strong> Institutional buys outperform over
          6-12 month windows, not 5-day windows. Position accordingly.
        </li>
      </ul>
    </LearnPageScaffold>
  );
}
