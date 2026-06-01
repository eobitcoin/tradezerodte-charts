import type { Metadata } from "next";
import LearnPageScaffold from "@/components/LearnPageScaffold";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

export const metadata: Metadata = {
  title: "Reading Sell Puts — Cash-Secured Short Put Scanner",
  description:
    "Every Sunday, Sell Puts ranks the most attractive cash-secured short-put opportunities across a locked ~50-ticker universe of large-cap US equities + index ETFs. Ranking is expected ROI = P(profit) × (credit / close), with risk-neutral Black-Scholes probability and the live chain bid. Here's how to read every column.",
  alternates: { canonical: `${APP_URL}/learn/sell-puts` },
  openGraph: {
    type: "article",
    url: `${APP_URL}/learn/sell-puts`,
    title: "Reading Sell Puts — Cash-Secured Short Put Scanner",
    description:
      "Expected ROI score, probability of profit, breakeven cushion, annualized return, slippage — and how the ranking model picks the top short puts each week.",
  },
};

export default function Page() {
  return (
    <LearnPageScaffold
      title="Reading Sell Puts — Cash-Secured Short Put Scanner"
      lead="Every Sunday, the Sell Puts scanner walks a locked universe of ~50 large-cap US equities + index ETFs, pulls each ticker's options chain via Polygon, and ranks the most attractive 21–45 DTE short put for each. The ranking model is the standard expected-ROI formula: P(profit) × (credit / stock close). Probability of profit is risk-neutral Black-Scholes derived from the contract's implied vol and time to expiry. Credit is the chain bid. Output is a ranked table — best-first — with one BUILD button per pick that drops you directly into Risk Graph."
      slug="sell-puts"
      faqs={[
        {
          question: "What does the scanner actually do?",
          answer:
            "For each of ~50 tickers in the locked universe, it pulls the live options chain via Polygon, filters to OTM puts in the 21–45 DTE window with a real bid (no zero-bid garbage), and computes P(profit) × (credit / close) for each. Each candidate is then bucketed into one of three PoP tiers — Conservative (PoP ≥ 85%), Balanced (70–85%), or Aggressive (<70%) — and the best pick within each tier is kept per ticker. Tickers can produce up to 3 picks total.",
        },
        {
          question: "What's the difference between Balanced / Conservative / Aggressive?",
          answer:
            "Three risk philosophies, three sub-tabs. (1) Conservative — PoP ≥ 85%, sorted by Annualized return. Far-OTM puts (5-10 delta) with small premium but deep cushion. Best for capital preservation, lower returns. (2) Balanced — PoP 70-85%, sorted by Expected ROI = PoP × credit/close. The standard wheel-strategy sweet spot — 15-25 delta puts, decent premium AND decent safety. Default tab. (3) Aggressive — PoP < 70%, sorted by Expected ROI. Near-ATM puts (30+ delta) with fattest credit but thin cushion. Best for short-vol traders willing to take assignment risk. The 'All' tab shows every tradeable pick across tiers (up to 3 per ticker, marked with C/B/A badges).",
        },
        {
          question: "Why does Conservative sort by Annualized instead of Expected ROI?",
          answer:
            "When PoP is already high (≥85%), the limiting factor is yield, not safety. Two conservative puts both with 90% PoP — one at 0.3% credit/close for 30 DTE (3.65% annualized), one at 0.5% for 45 DTE (4.06% annualized) — should rank by annualized return, not raw expected ROI. The longer trade looks slightly higher on expected ROI but ties up capital for 50% longer. Annualized makes the comparison apples-to-apples.",
        },
        {
          question: "How is Probability of Profit (PoP) computed?",
          answer:
            "Risk-neutral Black-Scholes. A short put profits when the stock closes ABOVE breakeven (= strike − credit) at expiry. Under the risk-neutral measure, P(S_T > breakeven) = N(d2) where d2 = (ln(S/K_breakeven) + (r − σ²/2)·T) / (σ·√T). We use r = 4% (risk-free rate), σ = contract's implied vol, T = DTE/365, S = current stock close. Output is bounded 0–1 and rendered as a 0–100% PoP chip color-coded emerald (≥70%) / amber (55–69%) / rose (<55%).",
        },
        {
          question: "What's the difference between PoP and delta?",
          answer:
            "Common confusion. Put delta is the P(option finishes ITM) under the risk-neutral measure — roughly P(S_T < strike). PoP for a short put is P(option finishes worthless OR with stock above breakeven) = P(S_T > strike − credit). Because of the credit cushion, PoP is always ≥ (1 − |delta|). For a 20-delta short put with $1 credit on a $50 stock, |delta| says 80% chance of expiring worthless, but PoP says ~85% chance of profit when you account for the dollar of premium cushion.",
        },
        {
          question: "Why expected ROI as the ranking, not just PoP?",
          answer:
            "PoP alone over-rewards far-OTM puts that have tiny credits. A 99% PoP put paying $0.05 on a $100 stock is essentially free money — except the $0.05 / $100 = 0.05% return on capital is worse than your savings account. Expected ROI = PoP × (credit/close) penalizes both directions: low PoP setups (selling fat premium close to ATM) get scored down on the probability, and tiny-credit setups get scored down on the return. The optimal zone is typically 70–85% PoP — enough probability to win consistently, enough credit to compound.",
        },
        {
          question: "What's the 'breakeven cushion' column?",
          answer:
            "100 × (close − breakeven) / close. It's the percentage drop the underlying can take from current spot before the trade goes negative at expiry. A 10% cushion means the stock can fall 10% by expiry and you still break even. Higher = safer. Use it as a sanity check against your own view: if you'd be worried holding the stock 10% lower, the cushion is too thin.",
        },
        {
          question: "Why annualized return?",
          answer:
            "credit/close is a per-trade return. Annualized = credit/close × 365/DTE scales it to a yearly basis so you can compare a 30-day trade against a 45-day trade fairly. A 1.5% / 30-day trade annualizes to 18%; a 2% / 45-day trade annualizes to 16%. The 30-day is actually the better deployment of capital, but only the annualized view shows it.",
        },
        {
          question: "What's Slippage and why does it matter?",
          answer:
            "100 × (ask − bid) / ask — the bid-ask spread as a percent of ask. Lower = tighter, more tradeable. Emerald ≤5% is excellent; amber 5–15% is tolerable; rose >15% means you'll lose meaningful edge to the spread. We use the BID as the credit assumption in ranking (executable for sell-to-open), but the mid would be lower, and a fill on the bid happens only when liquidity is there. Wide-spread picks are technically ranked correctly but practically harder to execute.",
        },
        {
          question: "What's the universe?",
          answer:
            "Locked list of ~50 large/mega-cap US equities + 3 index ETFs (SPY, QQQ, IWM), all selected for active weekly options, tight OTM put spreads, stock price >$30, and sector diversification. Examples: mega-cap tech (AAPL, MSFT, GOOGL, META, NVDA), financials (JPM, GS, V, MA), healthcare (UNH, LLY, JNJ), industrials (CAT, BA, LMT), consumer (HD, COST, MCD), energy (XOM, CVX), and the major index ETFs. Black-Scholes-derived probabilities work cleanly on these names because the IV surface is well-behaved (no meme-stock vol smiles, no 0DTE pin risk).",
        },
        {
          question: "Why 21–45 DTE?",
          answer:
            "The wheel-strategy sweet spot. Below 21 days, gamma risk gets large (small price moves swing P&L dramatically), and theta is too short to extract meaningful premium before the position reacts to news. Above 45 days, theta decay is slow and capital gets locked up too long for the marginal premium pickup. Empirically, professional put-sellers concentrate in this window because the risk-reward ratio is best and roll mechanics work cleanly.",
        },
        {
          question: "How should I size and trade these?",
          answer:
            "Cash-secure every short put — if assigned, you should be happy to own 100 shares at the strike. Set aside (strike × 100) per contract in buying power. Position size should be small enough that 2-3 assignments don't blow up your account if the market drops. Take profit at 50% of max (close when the put is worth half the credit you collected). Exit before earnings or any binary event you didn't intend to trade through. For most accounts, 2-5% of buying power per pick is reasonable; for retail accounts under $100k, 1-2 contracts per pick is typical.",
        },
        {
          question: "What about getting assigned?",
          answer:
            "Assignment means the put closed ITM and you're now long 100 shares per contract at the strike. Your effective cost basis is strike − credit (the breakeven number on the table). From there you can: (1) hold the shares if you wanted them anyway — this is the wheel — and start selling covered calls to harvest more premium; (2) close the position at a loss if your thesis broke; (3) roll the put down-and-out before expiry if assignment looks likely and you want to avoid taking the shares. Either way, the cushion column tells you how much room you had before assignment risk got real.",
        },
        {
          question: "Why isn't every ticker on the page?",
          answer:
            "Skip reasons: chain fetch failed (rare Polygon hiccup), no OTM puts in the 21–45 DTE window (some smaller names list only quarterly expiries), no put with bid > 0 (illiquid for the week), or no spot price (data gap). These rows are kept in the persisted scan for diagnostics but excluded from the page table since they're not tradeable.",
        },
        {
          question: "When does the scan run?",
          answer:
            "Sunday 23:00 UTC (6/7 PM ET) — runs AFTER the Earnings Scans cron so it can later reference earnings dates to avoid puts spanning earnings. Manual triggers go through /api/cron/sell-puts-scan with the SELL_PUTS_CRON_TOKEN bearer. Total runtime ~3 min for the locked 53-name universe.",
        },
      ]}
      related={[
        { slug: "risk-graph", title: "Building a Risk Graph" },
        { slug: "earnings-scans", title: "Reading Earnings Scans" },
        { slug: "cheap-leaps", title: "Reading Cheap LEAPs" },
      ]}
    >
      <h2>How the ranking works in one paragraph</h2>
      <p>
        Every cash-secured short put has a probability of profit (PoP)
        and a return on capital (credit/close). Multiply them together
        and you get <strong>expected ROI per trade</strong> — the
        right thing to maximize when picking. Far-OTM puts have high
        PoP but tiny credit (low expected ROI). Close-to-ATM puts have
        high credit but low PoP (also low expected ROI). The sweet spot
        — usually 70–85% PoP with 0.5–2% credit/close — has the highest
        expected ROI, and that&apos;s what the scanner surfaces.
      </p>

      <h2>What you&apos;re looking at per row</h2>
      <ul>
        <li>
          <strong>Symbol / Expiration</strong> — ticker and chosen expiry
          (within 21–45 DTE).
        </li>
        <li>
          <strong>Close / Strike / Breakeven</strong> — current stock
          close, the put&apos;s strike, and where the trade goes negative
          at expiry (strike − credit).
        </li>
        <li>
          <strong>Cushion</strong> — % drop the stock can take before
          trade goes negative. Higher is safer.
        </li>
        <li>
          <strong>Credit</strong> — the chain bid (executable price for
          sell-to-open). One contract = 100 × credit dollars collected.
        </li>
        <li>
          <strong>Credit/Close</strong> — credit as a percent of stock
          price. Direct ROI on the cash you tie up.
        </li>
        <li>
          <strong>P(profit)</strong> — Black-Scholes risk-neutral
          probability the stock closes above breakeven. Color-coded.
        </li>
        <li>
          <strong>Exp. ROI score</strong> — the headline ranking number.
          P(profit) × Credit/Close. Higher = better.
        </li>
        <li>
          <strong>Annualized</strong> — credit/close × 365/DTE.
        </li>
        <li>
          <strong>IV</strong> — contract&apos;s implied vol (drives PoP).
        </li>
        <li>
          <strong>Slip.</strong> — bid-ask spread as % of ask.
        </li>
        <li>
          <strong>OI</strong> — open interest on the contract. Higher =
          more liquidity, easier to fill and close.
        </li>
        <li>
          <strong>Build →</strong> — drops the position into Risk Graph
          with strike, expiry, and the sell-to-open side pre-filled.
        </li>
      </ul>

      <h2>What the scanner intentionally doesn&apos;t do</h2>
      <ul>
        <li>
          <strong>It doesn&apos;t avoid earnings dates yet.</strong> If a
          put spans an earnings announcement, IV will likely crush after
          the event — the credit may be juicy precisely because the
          market expects volatility. Cross-check picks against the
          Earnings Scans tab if you want to avoid earnings exposure.
        </li>
        <li>
          <strong>It doesn&apos;t check IV rank.</strong> Selling puts is
          best when IV is high relative to the underlying&apos;s norm; we
          don&apos;t filter by that yet. Cross-check against Options
          Edge for IV rank context.
        </li>
        <li>
          <strong>It doesn&apos;t check upcoming dividends.</strong>{" "}
          Ex-div dates change put premium behavior. For dividend-paying
          names (XOM, T, etc.), verify the ex-div date isn&apos;t between
          now and expiry.
        </li>
      </ul>
    </LearnPageScaffold>
  );
}
