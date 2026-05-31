import type { Metadata } from "next";
import LearnPageScaffold from "@/components/LearnPageScaffold";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

export const metadata: Metadata = {
  title: "Reading Unusual Activity — Smart-Money Options Flow",
  description:
    "Unusual Activity surfaces options prints over $50k premium where the aggressor side is clear and the trade size dwarfs prior-day OI. Sweeps, blocks, classification — here's how to read every card.",
  alternates: { canonical: `${APP_URL}/learn/unusual-activity` },
  openGraph: {
    type: "article",
    url: `${APP_URL}/learn/unusual-activity`,
    title: "Reading Unusual Activity — Smart-Money Options Flow",
    description:
      "Aggressor classification, OI multiplier, sweep flag — and how to follow the smart money without front-running noise.",
  },
};

export default function Page() {
  return (
    <LearnPageScaffold
      title="Reading Unusual Activity — Smart-Money Options Flow"
      lead="Every option trade leaves a fingerprint: trade size, price relative to bid/ask, prior open interest, condition codes. The Unusual Activity scanner walks the tape across a 25-ticker watchlist and surfaces only the prints that pass three independent bars — large premium, clear aggressor side, and a size that dwarfs the contract's prior-day OI. The result is a short list of trades where size and conviction both line up."
      slug="unusual-activity"
      faqs={[
        {
          question: "What's the filter for an 'unusual' print?",
          answer:
            "Three conditions must all hold: (1) Premium ≥ $50,000 — total notional (size × price × 100). (2) OI multiplier ≥ 3× — trade size is at least 3x the prior day's open interest on that exact strike/expiry. (3) Clear aggressor side — fill price within 1¢ of the bid (aggressive seller) or ask (aggressive buyer); midmarket fills are dropped because they don't carry signal. Sweeps (Polygon condition code 41) are flagged separately but don't gate the filter.",
        },
        {
          question: "What do the four classification labels mean?",
          answer:
            "Bullish call buy = aggressive buyer of calls (lifting offers). Bearish put buy = aggressive buyer of puts. Call sell = aggressive seller of calls (short call — either covered or directional bearish). Put sell = aggressive seller of puts (short put — often cash-secured or directional bullish). 'Ambiguous' (midmarket fills) is dropped from the scan entirely.",
        },
        {
          question: "What's a 'Sweep' and why does it matter?",
          answer:
            "A sweep is one order broken across multiple exchanges to grab all available liquidity simultaneously — Polygon flags this as condition code 41 (Intermarket Sweep Order). It's conventionally read as urgency: the trader didn't want to wait, suggesting either short-dated thesis or scale. Sweeps are weighted slightly heavier than equivalent-sized block trades in most institutional scanners; the violet 'Sweep' chip on the card surfaces them so you can spot the difference.",
        },
        {
          question: "Why a 3x OI multiplier?",
          answer:
            "It's the de-facto institutional standard. Below 3x, you're often watching market-makers shuffle inventory or vol traders adjusting hedges — not opening directional bets. At 3x+, the trade is meaningfully BIGGER than the existing open interest, which strongly implies a new position rather than a roll or close. Some scanners use 2x or 5x; we settled on 3x as a balance between signal and quantity. You can adjust in lib/uoa.ts if you want it tighter.",
        },
        {
          question: "Daily summary vs Latest intraday — what's the difference?",
          answer:
            "The daily summary (top of page when populated) is published at 4:15 PM ET after the EOD chain settles. It's the official 'flow of the day' record — top 25 prints across the watchlist with classification breakdown. The Latest intraday section (amber-pulse banner, appears during RTH) refreshes every 5 minutes with whatever has cleared the filter in the last hour. Both use the same uoa_prints table — the daily scan is a SUMMARY of the day's prints, the Latest section is a live RECENT-prints feed.",
        },
        {
          question: "How do I act on this in practice?",
          answer:
            "Treat it as a SIGNAL, not a TRADE. A single $200k bullish call sweep on AAPL doesn't mean buy AAPL calls — it means there's a 50-55% historical edge on the underlying moving in that direction over the next 5-20 trading days. Best practice: cross-reference with Options Edge (is the IV cheap?), check the catalyst calendar (earnings within 21 days?), and size as a directional bet, not a 'follow the whales' all-in. Hit rates on well-filtered sweeps are 55-60% — meaningful, but you need position sizing to capture it.",
        },
        {
          question: "Why aren't 0DTE prints in the list?",
          answer:
            "0DTE flow is dominated by dealer hedging, not directional bets — so it doesn't carry the same signal. The scanner doesn't explicitly exclude 0DTE, but the OI multiplier filter naturally trims most of it: 0DTE OI is huge by close so it's hard for a $50k print to be 3x the existing OI. Real institutional bets show up in 1-4 week and longer-dated chains, which is what surfaces here.",
        },
        {
          question: "What does 'Strike vs spot' mean?",
          answer:
            "The strike's distance from spot, as a percent. Positive = OTM call or ITM put; negative = ITM call or OTM put. For directional reads, very-OTM prints (+10% or more) are higher-conviction directional bets — the buyer wants leverage and is willing to pay the premium. Slightly-OTM prints (+2-5%) often pair with delta hedging or trend continuation.",
        },
        {
          question: "How is 'aggressor side' determined?",
          answer:
            "We compare the trade's reported fill price to the contract's NBBO bid and ask at trade time. Price ≥ ask − 1¢ → aggressive buyer (lifted the offer). Price ≤ bid + 1¢ → aggressive seller (hit the bid). Anything in between is midmarket — dropped from the scan. This is the textbook microstructure read of aggressor side, used by every institutional flow scanner.",
        },
        {
          question: "Can a small trader use this data?",
          answer:
            "Yes — but with realistic expectations. You can't lift a $200k contract block at the price the whale paid; by the time you read the page, the premium may have moved 10-20%. Where retail can win: (1) recognizing PATTERNS — same ticker getting hit with bullish call sweeps three days running is a real signal; (2) directional spreads — buy a $5-wide call spread on the underlying instead of trying to match the whale's exact contract; (3) Multi-week holds — the edge plays out over 5-20 days, not minutes.",
        },
      ]}
      related={[
        { slug: "options-edge", title: "Reading Options Edge" },
        { slug: "gamma-exposure", title: "Gamma Exposure (GEX) Explained" },
        { slug: "cheap-leaps", title: "Reading Cheap LEAPs" },
      ]}
    >
      <h2>The three-bar filter</h2>
      <p>
        The Unusual Activity scanner is conservative on purpose. The
        options tape is loud — millions of contracts trade every day,
        most carrying no directional signal. The three-bar filter
        (premium, OI multiplier, aggressor side) cuts the noise by
        roughly 99.9% before anything reaches your screen. What
        survives is a short list of trades where SIZE and CONVICTION
        both line up.
      </p>

      <h2>Reading a print card</h2>
      <p>
        <strong>Top row.</strong> Ticker · strike + call/put + DTE ·
        BOT or SLD chip (aggressor side) · classification chip
        (bullish call buy / bearish put buy / call sell / put sell) ·
        Sweep badge if applicable · total premium.
      </p>
      <p>
        <strong>Detail row.</strong> Size · Price · OI multiplier ·
        Strike vs spot · Tape time (ET). The OI multiplier in
        particular is the single most useful number — anything 5×+ is
        meaningfully bigger than the contract&apos;s prior position
        base and almost certainly opening flow.
      </p>

      <h2>How signal stacks</h2>
      <ul>
        <li>
          <strong>Size + sweep + OTM = strongest signal.</strong> A
          $200k+ sweep on a +5-10% OTM strike, especially with multiple
          prints in a 30-minute window, is the institutional pattern
          most retail flow services charge to alert on.
        </li>
        <li>
          <strong>Repeated direction = real signal.</strong> Same
          ticker, same direction, multiple prints over 2-3 days. The
          first print could be a hedge; the third is a thesis.
        </li>
        <li>
          <strong>Conflicting flow = no signal.</strong> If today shows
          $300k bullish call buys AND $250k bearish put buys on the
          same ticker, two different desks have opposite theses —
          neutral.
        </li>
      </ul>

      <h2>What this is NOT</h2>
      <p>
        Following options flow is NOT a get-rich strategy. Well-filtered
        sweeps have a 55-60% directional hit rate over the next 5-20
        trading days. That&apos;s a real edge, but it requires
        position sizing (winners pay for losers) and patience (the
        thesis often takes 1-3 weeks to play out). The cards on this
        page are the SHORT LIST — what to investigate, not what to
        copy-trade.
      </p>
    </LearnPageScaffold>
  );
}
