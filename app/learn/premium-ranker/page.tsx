import type { Metadata } from "next";
import LearnPageScaffold from "@/components/LearnPageScaffold";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

export const metadata: Metadata = {
  title: "Reading Premium Ranker — High-IV / Premium Scanner",
  description:
    "Every Sunday, Premium Ranker scans the entire US-stock options market — every name priced $20+ with daily volume over 500,000 — and ranks it two ways: by 30-day ATM implied volatility and by short-put premium richness. The three headline ideas pair each name's best cash-secured naked put with a defined-risk put credit spread, each with an AI-written read on why the setup is rich and an honest probability assessment. Here's how to read every column.",
  alternates: { canonical: `${APP_URL}/learn/premium-ranker` },
  openGraph: {
    type: "article",
    url: `${APP_URL}/learn/premium-ranker`,
    title: "Reading Premium Ranker — High-IV / Premium Scanner",
    description:
      "Full-market IV ranking, annualized short-put premium, risk-neutral probability of profit, the 3 headline naked-put + credit-spread ideas, and the AI Why/Probability analysis — how the weekly scan picks the richest premium-selling setups.",
  },
};

export default function Page() {
  return (
    <LearnPageScaffold
      title="Reading Premium Ranker — High-IV / Premium Scanner"
      lead="Every Sunday, Premium Ranker runs a full-market funnel for premium sellers. It pulls the entire US-stock snapshot via Polygon (~13,000 names), keeps the ones priced $20 or more with daily volume over 500,000 and listed options, then deep-scans each survivor's 21–45 DTE option chain. Every name is ranked two ways — by 30-day ATM implied volatility (the richest vol) and by short-put annualized premium (the richest yield). From the cleanest top-IV names it builds three headline trade ideas, each pairing a cash-secured naked put with a defined-risk put credit spread, and each carrying an AI-written read of why the setup is attractive and an honest probability assessment."
      slug="premium-ranker"
      faqs={[
        {
          question: "What does the scanner actually do?",
          answer:
            "It runs a four-stage funnel. (1) Pull the Polygon all-tickers snapshot — every US stock with a price and a day's volume. (2) Keep names priced $20+, with daily volume over 500,000, that are common stocks or ADRs with listed options (leveraged/inverse ETFs and ETNs are filtered out — they top a raw IV ranking but aren't stocks and are unsafe premium sells). (3) Deep-scan each survivor's option chain in the 21–45 DTE window: compute 30-day ATM implied vol, ATM straddle as a % of spot, and the single best short put (by P(profit) × credit%). (4) Rank everything by IV and by annualized premium, store the top 120, and build 3 headline trade ideas from the richest cleanly-tradeable names.",
        },
        {
          question: "How is the universe different from Sell Puts?",
          answer:
            "Sell Puts walks a locked ~50-name list of large-caps + index ETFs — names with well-behaved IV surfaces, picked for safety. Premium Ranker is the opposite: it scans the entire market with no pre-set list, so it surfaces wherever premium is actually richest this week. That's usually small/mid-caps with elevated IV (earnings, events, momentum names), which means higher yield AND higher risk. Use Sell Puts for the wheel on quality names; use Premium Ranker to see where the fat premium is — and to understand why it's fat before you touch it.",
        },
        {
          question: "How is ATM implied volatility computed?",
          answer:
            "For the expiry closest to 30 DTE inside the 21–45 day window, we take the call and put nearest to spot, read each contract's implied volatility off the chain, and average the two. This is a clean ATM read rather than a surface fit — good enough to rank names by how much vol the market is pricing. Examples from a typical scan: a mega-cap like NVDA lands near 37%, TSLA ~46%, a name like COIN ~72%, and small-cap miners or biotechs can run 100–160%.",
        },
        {
          question: "What is the 'best put' and how is it chosen?",
          answer:
            "Among the OTM puts in the target expiry with a real bid, we pick the one that maximizes P(profit) × credit% of spot — the same expected-value logic Sell Puts uses. Credit is the chain mid. The result carries the strike, expiry, credit, breakeven (strike − credit), annualized return (credit/spot × 365/DTE), and a risk-neutral probability of profit. This 'best put' drives the per-row Risk Graph link and seeds the headline naked-put idea.",
        },
        {
          question: "How is Probability of Profit (PoP) computed?",
          answer:
            "Risk-neutral Black-Scholes, identical to the rest of the platform. A short put profits when the stock closes above breakeven (strike − credit) at expiry, so PoP = N(d2) where d2 = (ln(S/breakeven) + (r − σ²/2)·T) / (σ·√T), with r = 4%, σ = the contract's implied vol, T = DTE/365, S = spot. It's bounded 0–1 and rendered as a 0–100% figure. Crucially, this is a model number — it assumes lognormal returns and ignores fat tails, overnight gaps, and assignment mechanics, which is exactly what the AI Probability read is there to contextualize.",
        },
        {
          question: "What are the two rankings — IV vs Premium?",
          answer:
            "The table toggles between them. 'Highest IV' sorts by 30-day ATM implied volatility — where the market is pricing the biggest moves. 'Highest premium' sorts by the best short put's annualized return on risk (credit/spot × 365/DTE) — where the per-day yield is richest. They usually correlate (high IV means fat credit) but not always: a name can have high IV but no cleanly-tradeable put (wide spreads, no OI), and a slightly-lower-IV name can offer better executable yield. Looking at both is the point.",
        },
        {
          question: "What is the AI analysis on the top 3 picks?",
          answer:
            "Each of the three headline ideas gets a short, neutral read written by Claude (Opus 4.8) once per week at scan time — never on page load. It has two parts. 'Why' explains why the setup is (or isn't) attractive for premium selling, referencing the concrete IV, credit, and any earnings driver. 'Probability & risk' contextualizes the risk-neutral PoP — what it does and doesn't account for — and names the specific way the trade loses. Each pick is first checked against the Finnhub earnings calendar across its DTE window; if a report falls inside the window, the card shows an 'Earnings in window' badge and the analysis treats that event as the likely reason IV is elevated.",
        },
        {
          question: "Why does an 'Earnings in window' badge matter so much?",
          answer:
            "An earnings report inside the trade window is the single most common reason IV (and therefore premium) is elevated. That's a double-edged setup: you collect rich premium, but you're explicitly short a binary event that can gap the stock through your breakeven in one print. High IV here is the market pricing that gap correctly, not a free lunch. When the badge is present, the AI read calls it out and the defined-risk credit spread (which caps the tail) is usually the more sensible expression than the naked put.",
        },
        {
          question: "What's the defined-risk credit spread the headline ideas show?",
          answer:
            "Alongside each naked put, we build a put credit spread: short the same strike, long a put roughly one band (~5% of spot, minimum one strike) below. It shows net credit, width, max profit, max loss, and breakeven. The trade-off is the classic one — the spread sacrifices most of the naked put's premium in exchange for a known, capped worst case instead of open downside to (theoretically) zero. On high-IV names, and especially on earnings-in-window setups, that cap is usually worth the lost credit. If no clean long strike exists below the short, the idea is naked-put-only.",
        },
        {
          question: "Why annualized return instead of raw credit?",
          answer:
            "credit/spot is a per-trade return; annualized = credit/spot × 365/DTE scales it to a yearly basis so a 25-DTE trade and a 45-DTE trade compare fairly. A juicy-looking absolute credit on a 45-day put can annualize worse than a smaller credit on a 25-day put. The annualized column is what makes the 'Highest premium' ranking an apples-to-apples yield comparison across names and expiries.",
        },
        {
          question: "What's the 'IV rank' column?",
          answer:
            "For the stored top names, we look up that ticker's own IV history (from the daily IV snapshots that feed Options Edge) and compute where today's 30-day ATM IV sits in its trailing ~1-year range, 0–100. A high absolute IV with a low IV rank means the name is always volatile (the premium may be fair); a high IV rank means vol is elevated relative to its own norm, which is the better backdrop for selling. It's blank when there isn't enough history (≥20 snapshots) to compute it.",
        },
        {
          question: "Why is a name in the table but not one of the 3 ideas?",
          answer:
            "The headline ideas apply extra quality filters the full table doesn't: the best put's probability of profit must fall in a tradeable 60–92% band (not a near-certain pennies-for-steamrollers put, not a coin-flip), and the contract needs open interest of at least 100 so it's actually liquid. The very highest-IV names are often the junkiest to trade — illiquid, wide spreads, falling knives — so they rank at the top of the table but get filtered out of the suggestions.",
        },
        {
          question: "When does the scan run?",
          answer:
            "Sunday evening (UTC), via the PREMIUM_RANKER_CRON_TOKEN-protected /api/cron/premium-ranker-scan endpoint. The full-market deep scan of ~2,000 survivors finishes in well under a minute (single-page chain slices, bounded concurrency), then the 3 AI reads run in parallel — a few extra seconds and a few cents of model spend per week. The AI step is best-effort: if it ever fails (e.g. an API blip), the pick keeps a deterministic one-line thesis instead and the scan still publishes.",
        },
        {
          question: "How should I actually use this?",
          answer:
            "Treat it as a where's-the-premium radar, not a buy list. A high annualized number almost always means high IV for a reason — read the AI 'Why' and 'Probability' first, check the 'Earnings in window' badge, and look at IV rank for context. Cash-secure any naked put you'd be assigned on, prefer the defined-risk spread on event-driven names, and size so two or three of these going against you at once doesn't hurt. Every idea deep-links into Risk Graph so you can see the payoff before committing.",
        },
      ]}
      related={[
        { slug: "sell-puts", title: "Reading Sell Puts" },
        { slug: "options-edge", title: "Reading Options Edge (IV rank)" },
        { slug: "risk-graph", title: "Building a Risk Graph" },
      ]}
    >
      <h2>The idea in one paragraph</h2>
      <p>
        Sell Puts asks &ldquo;among a safe, locked list of quality names, which
        short put has the best expected ROI this week?&rdquo; Premium Ranker
        asks a broader question: &ldquo;across the <em>entire</em> US-stock
        options market, where is premium actually richest right now — and why?
        &rdquo; It ranks every optionable, liquid, $20+ name by implied vol and
        by short-put yield, then hands the three cleanest top-IV setups to an
        AI analyst that explains the catalyst, flags earnings risk, and gives an
        honest read on the probability the model number is quietly overstating.
      </p>

      <h2>What you&apos;re looking at per row</h2>
      <ul>
        <li>
          <strong>Ticker / Price / Volume</strong> — the name, current spot,
          and the day&apos;s share volume (the liquidity gate it cleared).
        </li>
        <li>
          <strong>IV</strong> — 30-day ATM implied volatility, the primary
          &ldquo;Highest IV&rdquo; ranking. The headline number.
        </li>
        <li>
          <strong>IV rank</strong> — where today&apos;s IV sits in the
          name&apos;s own trailing-year range (0–100). High rank = vol elevated
          vs its own norm.
        </li>
        <li>
          <strong>Straddle</strong> — the ATM call + put as a % of spot, a
          quick read on the dollar move the market is pricing.
        </li>
        <li>
          <strong>Best put</strong> — the strike and expiry of the most
          attractive short put (max P(profit) × credit%).
        </li>
        <li>
          <strong>Credit</strong> — the chain mid for that put. One contract =
          100 × credit dollars collected.
        </li>
        <li>
          <strong>Ann. %</strong> — annualized return on risk = credit/spot ×
          365/DTE. The &ldquo;Highest premium&rdquo; ranking.
        </li>
        <li>
          <strong>PoP</strong> — risk-neutral Black-Scholes probability the
          stock closes above breakeven at expiry.
        </li>
        <li>
          <strong>Risk Graph →</strong> — drops the short put into Risk Graph
          with strike, expiry, and the sell-to-open side pre-filled.
        </li>
      </ul>

      <h2>What the top 3 cards add</h2>
      <ul>
        <li>
          <strong>Naked put + credit spread</strong> — each pick pairs the
          cash-secured short put with a defined-risk put credit spread, both
          deep-linked into Risk Graph.
        </li>
        <li>
          <strong>AI &ldquo;Why&rdquo;</strong> — why the setup is (or
          isn&apos;t) attractive for premium selling, tied to the concrete IV,
          credit, and any earnings driver.
        </li>
        <li>
          <strong>AI &ldquo;Probability &amp; risk&rdquo;</strong> — an honest
          read on the risk-neutral PoP (fat tails, gaps, assignment) and the
          specific way the trade loses.
        </li>
        <li>
          <strong>Earnings-in-window badge</strong> — flags when a report falls
          inside the trade window, the usual reason IV is rich and the case for
          the defined-risk version over the naked put.
        </li>
      </ul>

      <h2>What the scanner intentionally doesn&apos;t do</h2>
      <ul>
        <li>
          <strong>It doesn&apos;t tell you to put the trade on.</strong> A high
          annualized number usually means high IV for a reason. The AI read and
          the earnings badge exist precisely so you understand that reason
          before sizing anything.
        </li>
        <li>
          <strong>It doesn&apos;t guarantee liquidity on the table rows.</strong>{" "}
          The full table includes names that fail the suggestion filters (thin
          OI, wide spreads). Only the 3 headline ideas are screened for a
          tradeable PoP band and open interest ≥ 100.
        </li>
        <li>
          <strong>It isn&apos;t advice.</strong> Premium selling carries
          assignment and tail risk — a naked put&apos;s downside runs to (in
          theory) zero. Cash-secure it, prefer the spread on event names, and
          size accordingly.
        </li>
      </ul>
    </LearnPageScaffold>
  );
}
