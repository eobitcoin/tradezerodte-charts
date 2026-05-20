import type { Metadata } from "next";
import LearnPageScaffold from "@/components/LearnPageScaffold";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

export const metadata: Metadata = {
  title: "Insider Buys (SEC Form 4) — What CEO Buying Actually Means",
  description:
    "SEC Form 4 discloses every insider trade within 2 business days. Insider BUYS are signal — sales are noise. How to weight CEO vs Director, why cluster buys matter, and what to actually do with the data.",
  alternates: { canonical: `${APP_URL}/learn/insider-buys` },
  openGraph: {
    type: "article",
    url: `${APP_URL}/learn/insider-buys`,
    title: "Insider Buys (SEC Form 4) — What CEO Buying Actually Means",
    description:
      "Form 4 primer, why buys matter and sales don't, the role-weighting hierarchy, and the cluster signal.",
  },
};

export default function Page() {
  return (
    <LearnPageScaffold
      title="Insider Buys (SEC Form 4) — What CEO Buying Actually Means"
      lead='Peter Lynch put it best: "Insiders may sell their shares for any number of reasons, but they buy them for only one — they think the price will rise." Form 4 filings disclose every insider transaction within 2 business days. Reading them well means understanding why buys are signal, why sales are noise, and how to weight by role + size + cluster behavior.'
      slug="insider-buys"
      faqs={[
        {
          question: "What is SEC Form 4?",
          answer:
            "The filing corporate insiders must submit within 2 business days of trading their company's stock. Insiders are: officers (CEO, CFO, etc.), directors, and any 10%+ shareholders. Each filing shows the insider's name + role, the transaction code (P = open-market purchase, S = sale, A = grant, M = option exercise), share count + price, and total holdings after the transaction.",
        },
        {
          question: "Why are insider BUYS signal but SALES not?",
          answer:
            "Insiders sell for dozens of unrelated reasons: diversification, tax planning, 10b5-1 scheduled sales, a house purchase, divorce settlement, charity. Almost none of those are signal. Insiders BUY their own stock in the open market for one reason — they think it's undervalued. They can't legally use material non-public information, so the buy is 'informed person with personal capital on the line agrees the price is too low.'",
        },
        {
          question: "How should I weight different insider roles?",
          answer:
            "Strongest: CEO and CFO buying (closest to operating reality and the financials). Strong: 3+ insiders buying same week (independent confluence — they can't coordinate without legal exposure). Moderate: meaningful position-size adds by board members. Weakest: 10%+ shareholder rebalancing (could be passive flow) or single outside director symbolic buys.",
        },
        {
          question: "What's a 'cluster' buy and why does it matter?",
          answer:
            "When 3+ different insiders at the same company buy within the same week — all independently, since coordination has legal exposure. The signal is multiple informed people independently reaching the same 'this is cheap' conclusion. Statistically the strongest pattern in Form 4 data; clusters outperform lone-wolf buys over 6-12 month windows.",
        },
        {
          question: "Should I size for short-term or long-term holds?",
          answer:
            "Long-term. Studies have consistently shown insider buys outperform over 6-12 month windows, not 5-day windows. Insiders are notoriously early — CEOs buying their own falling-knife stock is a common pattern. Treat insider buys as 'something is fundamentally interesting here' rather than 'buy tomorrow.' Position for a multi-month hold.",
        },
        {
          question: "Why exclude option exercises and grants from the signal set?",
          answer:
            "Transaction code A (grants) are compensation — insiders didn't choose to buy with personal capital. Code M (option exercises) often happen at scheduled dates or near expiry, not because the insider thinks the stock is cheap. Only code P (open-market purchases with the insider's own money) reflects conviction.",
        },
      ]}
      related={[
        { slug: "weekly-research", title: "Weekly Research — How to Read a Setup" },
        { slug: "institutional-flow", title: "13F Institutional Flow" },
        { slug: "earnings-whiplash", title: "Earnings Whiplash" },
        { slug: "polymarket-whales", title: "Polymarket Whale Tracking" },
        { slug: "0dte-options", title: "What is 0DTE Options Trading?" },
      ]}
    >
      <h2>The role hierarchy, ranked</h2>
      <ol>
        <li>
          <strong>CEO buying.</strong> Strongest signal. The person closest to operating
          reality putting personal capital in.
        </li>
        <li>
          <strong>CFO buying.</strong> Second strongest. CFO sees the financials most
          clearly.
        </li>
        <li>
          <strong>Multiple board members same week.</strong> Cluster signal. Board sees
          forward visibility.
        </li>
        <li>
          <strong>10%+ shareholder adding.</strong> Weaker. Could be passive flow
          (index rebalance, fund creation).
        </li>
        <li>
          <strong>Single outside director.</strong> Weakest. Often a signal-of-confidence
          gesture, not a high-conviction position.
        </li>
      </ol>

      <h2>Size matters — but in relative terms</h2>
      <p>
        Look at the buy as a <strong>% of the insider&apos;s existing position</strong>,
        not the absolute dollar amount. A CEO buying $500K when she already owns $50M
        is signaling confidence but not high conviction. A board member buying $200K when
        his total holdings are $400K is doubling down — that&apos;s the move worth
        paying attention to.
      </p>
      <p>
        Rule of thumb: meaningful buy ≥ 25% of insider&apos;s prior position value, AND
        ≥ 6 months since their last buy at this ticker. Both conditions filter out
        routine 10b5-1 plan adds (those are scheduled, not opportunistic).
      </p>

      <h2>The cluster pattern</h2>
      <p>
        3+ insiders buying the same ticker in the same week is rare AND notable. Each
        filing is independent — they can&apos;t coordinate without legal exposure — so a
        cluster implies multiple informed people separately reaching the same
        &quot;this is cheap&quot; conclusion. Statistical edge: clusters outperform
        lone-wolf buys over 6-12 month windows.
      </p>

      <h2>How to act on a buy you find compelling</h2>
      <ol>
        <li>Check the size as % of the insider&apos;s existing position. ≥ 25% is meaningful.</li>
        <li>
          Look up the chart. If the stock is already up 30%+ in 6 months, insider buying
          after a run is weaker signal than buying into weakness.
        </li>
        <li>
          Check recent news. An insider buying after a big earnings miss or sector
          selloff is the kind of &quot;dip-buy&quot; pattern that has historically
          worked. Insider buying near all-time highs is rarer and less reliable.
        </li>
        <li>
          Cross-check with 13F institutional flow. If smart-money funds are ALSO
          accumulating, that&apos;s confluence.
        </li>
        <li>
          Plan for a multi-month hold. This is not a day-trade signal.
        </li>
      </ol>

      <h2>Honest limits</h2>
      <ul>
        <li>
          <strong>Insiders can be wrong.</strong> CEOs buying their own falling-knife
          stock is a common Form 4 pattern. They&apos;re bullish on their company —
          that doesn&apos;t guarantee the market agrees in the near term.
        </li>
        <li>
          <strong>Optics buys exist.</strong> Some director purchases are specifically
          to be SEEN buying — defensive PR during a sell-off. Size + cluster filters
          help, but don&apos;t eliminate it.
        </li>
        <li>
          <strong>Form 4 is public.</strong> Everyone sees it. The trade is the same
          trade everyone else can take. Edge comes from CONVICTION about what the buy
          means and willingness to wait, not from the data being secret.
        </li>
      </ul>
    </LearnPageScaffold>
  );
}
