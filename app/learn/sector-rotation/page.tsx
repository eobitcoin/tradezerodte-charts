import type { Metadata } from "next";
import LearnPageScaffold from "@/components/LearnPageScaffold";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

export const metadata: Metadata = {
  title: "Sector Rotation — How to Detect Leadership Flips Early",
  description:
    "Sector rotation drives most multi-month equity moves. Comparing 30-day relative strength now vs the same window one year ago surfaces leadership flips before they hit headlines. How to read RS, money-flow proxies, and the YoY comparison.",
  alternates: { canonical: `${APP_URL}/learn/sector-rotation` },
  openGraph: {
    type: "article",
    url: `${APP_URL}/learn/sector-rotation`,
    title: "Sector Rotation — How to Detect Leadership Flips Early",
    description:
      "Relative strength, year-over-year comparison, money flow — how to spot which sectors are rotating before headlines pick it up.",
  },
};

export default function Page() {
  return (
    <LearnPageScaffold
      title="Sector Rotation — How to Detect Leadership Flips Early"
      lead="The market doesn't move in one piece. Capital rotates between sectors in long cycles, and catching the flip — when relative strength changes sign before headlines pick up the story — is the entire point. Here's how to measure RS, the year-over-year comparison logic, and what 10-day money flow rankings tell you about where institutional capital is moving."
      slug="sector-rotation"
      faqs={[
        {
          question: "What is sector rotation?",
          answer:
            "The pattern where capital flows between sectors over multi-month cycles based on macro conditions, earnings cycles, and risk appetite. Late-cycle rotation typically moves money toward defensives (Utilities, Staples, Health Care); early-cycle moves it toward cyclicals (Financials, Industrials, Tech). Detecting the flip early is how you position before the trend is obvious.",
        },
        {
          question: "What is relative strength (RS) in sector context?",
          answer:
            "RS = sector ETF's 30-day return MINUS SPY's 30-day return for the same window. Positive RS means the sector outperformed the index. Negative RS means it lagged. The number is the magnitude of out/underperformance — small RS swings are noise; >2 percentage points is meaningful.",
        },
        {
          question: "Why compare to the same window one year ago?",
          answer:
            "Year-over-year comparison controls for seasonality (Energy is often strong in Q2-Q3, Consumer in Q4) and for prevailing market regime. The question becomes: 'is leadership today fundamentally different from leadership this calendar window last year?' If yes, something structural has shifted. If RS sign flipped from negative to positive (or vice versa) and the magnitude is meaningful, that's the flag.",
        },
        {
          question: "How is 'money flow' for an ETF measured?",
          answer:
            "True ETF money flow = creation/redemption volume from authorized participants. That data publishes with 1-day lag and isn't freely available real-time. The standard proxy: sum over N days of (price × volume × sign(close − prior_close)). Positive proxy = net buying pressure on up days. It correlates with true money flow but isn't identical.",
        },
        {
          question: "Why rank the top 5 ETFs within each rotating sector?",
          answer:
            "The SPDR primary (XLK, XLE, etc.) isn't always where flow is concentrating. If SOXX is ranking above XLK in a rotating-Tech sector, the rotation is concentrated in semis, not broad tech — that's actionable specificity. Cross-checking specialty ETFs against the primary tells you what flavor of the rotation is real.",
        },
        {
          question: "How reliable is a single-window RS flip?",
          answer:
            "Roughly half of all RS sign flips reverse within a quarter. Use the methodology section of each scan to check whether the flip is confirmed across multiple windows or just one. Single-window flips are candidates, not certainties. Combine with money flow concentration + reasonable thesis for stronger signal.",
        },
      ]}
      related={[
        { slug: "weekly-research", title: "Weekly Research — How to Read a Setup" },
        { slug: "institutional-flow", title: "13F Institutional Flow" },
        { slug: "earnings-whiplash", title: "Earnings Whiplash" },
        { slug: "gamma-exposure", title: "Gamma Exposure Explained" },
        { slug: "0dte-options", title: "What is 0DTE Options Trading?" },
      ]}
    >
      <h2>The four direction buckets</h2>
      <p>The scan classifies each sector into one of four buckets:</p>
      <ul>
        <li>
          <strong>Turning positive ↗</strong> — RS was negative a year ago, positive
          now. New leadership emerging.
        </li>
        <li>
          <strong>Turning negative ↘</strong> — RS was positive a year ago, negative
          now. Leadership decaying.
        </li>
        <li>
          <strong>Stable positive</strong> — already leading, still leading. No fresh
          signal.
        </li>
        <li>
          <strong>Stable negative</strong> — already lagging, still lagging. No fresh
          signal.
        </li>
      </ul>
      <p>
        Only the <strong>turning_*</strong> sectors get the full treatment (top 5
        ETFs, money flow ranking, thesis). The stable sectors render as compact
        context so you can see the full landscape at a glance.
      </p>

      <h2>How to use the top-5 ETF ranking</h2>
      <ul>
        <li>
          <strong>#1 is where money is concentrating.</strong> Cleanest expression of
          the rotation.
        </li>
        <li>
          <strong>Specialty above SPDR is a tell.</strong> SOXX above XLK in Tech = semis
          driving the rotation, not broad tech.
        </li>
        <li>
          <strong>Cross-check AUM.</strong> A small ETF with huge flow may be a flash
          in the pan (one big buyer); a $20B fund with steady inflow is real allocation.
        </li>
        <li>
          <strong>Read flow alongside 30d return.</strong> Flow in + price flat or down
          = smart-money buying weakness. Flow in + price up = momentum + flow alignment.
        </li>
      </ul>

      <h2>How to position</h2>
      <ul>
        <li>
          <strong>Turning positive:</strong> consider long positions in the #1 or #2
          ranked ETF. Classic &quot;buy the leaders.&quot; Time horizon: weeks to
          months.
        </li>
        <li>
          <strong>Turning negative:</strong> consider reducing exposure to the SPDR +
          checking individual holdings. The first leg of a sector rolling over is
          often the deepest.
        </li>
        <li>
          <strong>Pair-trade angle:</strong> long the rotating-positive sector ETF +
          short SPY isolates the relative outperformance and removes broad market
          direction.
        </li>
      </ul>

      <h2>Honest limits</h2>
      <ul>
        <li>
          <strong>Many flips reverse.</strong> Single-window flips are candidates, not
          certainties. Treat with appropriate skepticism.
        </li>
        <li>
          <strong>YoY comparison can be noisy.</strong> If the same window last year had
          unusual conditions (vol spike, sector-specific shock), the flip can be
          mechanical artifact rather than signal.
        </li>
        <li>
          <strong>GICS taxonomy drifts.</strong> Sector definitions change (e.g., telcos
          moved to Communication Services in 2018). Historical comparisons crossing
          those boundaries need adjustment, which the scan documents in methodology when
          applicable.
        </li>
      </ul>
    </LearnPageScaffold>
  );
}
