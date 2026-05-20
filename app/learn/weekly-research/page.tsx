import type { Metadata } from "next";
import LearnPageScaffold from "@/components/LearnPageScaffold";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

export const metadata: Metadata = {
  title: "Weekly Research — How to Read a Per-Ticker Setup",
  description:
    "Weekly Research delivers per-ticker writeups with weekly + daily charts, sentiment chips, and a one-line headline of the regime. How to use the headline, charts, and body together — and what NOT to assume from a single post.",
  alternates: { canonical: `${APP_URL}/learn/weekly-research` },
  openGraph: {
    type: "article",
    url: `${APP_URL}/learn/weekly-research`,
    title: "Weekly Research — How to Read a Per-Ticker Setup",
    description:
      "Headline, sentiment, weekly chart, daily chart — how to combine them for an actionable read on a stock.",
  },
};

export default function Page() {
  return (
    <LearnPageScaffold
      title="Weekly Research — How to Read a Per-Ticker Setup"
      lead="Each Weekly Research post is one ticker, one scan day, four blocks: a headline that gives you the regime in a sentence, sentiment + bias chips, a markdown body with key levels and catalysts, and two charts (weekly first, daily second). Knowing how to combine these is the difference between glancing at a chart and actually reading it."
      slug="weekly-research"
      faqs={[
        {
          question: "What is a per-ticker weekly research post?",
          answer:
            "A long-form writeup for a single ticker on a single scan day. The post includes a title, a one-line headline summary of the read, sentiment + bias chips, a markdown body explaining the catalyst and key levels, and weekly + daily charts. Each ticker × day is its own post, keyed on (ticker, scan_day).",
        },
        {
          question: "How is this different from the daily 0DTE trade-idea report?",
          answer:
            "The daily 0DTE report is on the home page and focuses on intraday trade ideas with explicit entry/target/stop levels. Weekly Research is structural — multi-week regime context, key levels, what could invalidate. Different time horizon, different purpose.",
        },
        {
          question: "Should I trade off a Weekly Research post?",
          answer:
            "Treat it as a structural read, not a trade order. The headline tells you the regime; the body explains the catalyst; the charts show context. Use it to inform position sizing and entry timing, not as a trigger. Always cross-check current price before acting — posts age, and a bullish read from 5 days ago may not still hold.",
        },
        {
          question: "How should I read the weekly vs daily chart?",
          answer:
            "Weekly chart = structural permission slip. Use it to confirm the trend direction over multi-month context — major support/resistance, regime status. Daily chart = trigger timing. Use it to identify entry windows relative to short-term levels. Together: weekly says whether to be long/short, daily says when.",
        },
        {
          question: "What do the sentiment and bias chips mean?",
          answer:
            "Sentiment is the post author's overall read: bullish, bearish, or neutral. Bias is a free-form tag like 'fade-rallies', 'dip-buy zone', or 'wait for break'. Sentiment is the direction; bias is the playbook. Both reflect the read at scan time — markets shift, treat with appropriate freshness.",
        },
      ]}
      related={[
        { slug: "institutional-flow", title: "13F Institutional Flow Explained" },
        { slug: "earnings-whiplash", title: "Earnings Whiplash — Implied vs Realized Vol" },
        { slug: "sector-rotation", title: "Sector Rotation — What Leadership Flips Tell You" },
        { slug: "insider-buys", title: "Reading Insider Buys (SEC Form 4)" },
        { slug: "0dte-options", title: "What is 0DTE Options Trading?" },
      ]}
    >
      <h2>The headline does most of the work</h2>
      <p>
        If you only have 30 seconds, read the headline. A good headline gives you the
        regime in one if-then sentence: <em>&quot;SPY: bullish above 530 weekly pivot,
        bearish below 520.&quot;</em> That tells you the framework — where the
        decision points are and what each side means. Everything below the headline
        is detail that informs the framework.
      </p>

      <h2>The body is for catalysts, not opinions</h2>
      <p>
        The markdown body explains <em>why</em> the chart matters this week. Catalysts
        worth reading carefully: earnings, sector dispersion, macro print, options
        positioning (especially around max pain or gamma flip strikes), insider
        activity, institutional accumulation. If you can&apos;t articulate the catalyst
        after reading, the post hasn&apos;t done its job — or you haven&apos;t finished
        reading. Either way, don&apos;t trade on it yet.
      </p>

      <h2>Use the sidebar to scan, the body to act</h2>
      <p>
        The sidebar lists the most recent writeups across all tickers. Skim it daily.
        For tickers you actually trade, open the post and work through it
        deliberately: headline → sentiment → body → charts → cross-checks (institutional
        flow, earnings calendar, insider buys). One screen of context before any trade
        decision.
      </p>

      <h2>Honest limits</h2>
      <ul>
        <li>
          <strong>Posts age.</strong> A 5-day-old weekly read is partial signal at best.
          The sidebar timestamps tell you scan date.
        </li>
        <li>
          <strong>Charts are reference, not real-time.</strong> Always confirm current
          price before acting.
        </li>
        <li>
          <strong>One ticker = one post.</strong> If a ticker isn&apos;t covered this
          week, no positive or negative inference is implied. Absence of coverage is
          not absence of opportunity (or risk).
        </li>
        <li>
          <strong>Not investment advice.</strong> These are research notes for
          structural reads, not trade orders.
        </li>
      </ul>
    </LearnPageScaffold>
  );
}
