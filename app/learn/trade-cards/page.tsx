import type { Metadata } from "next";
import LearnPageScaffold from "@/components/LearnPageScaffold";

const APP_URL = process.env.APP_URL || "https://www.tradezerodte.com";

export const metadata: Metadata = {
  title: "Reading the Trade Cards — Stamps, Status, and the Scan Hierarchy",
  description:
    "Each Trade Card is the current authoritative plan for one ticker. Premarket sets the plan; market-open revises; analysis comments; settlement stamps the outcome. Here's how to read every badge, stamp, and diff.",
  alternates: { canonical: `${APP_URL}/learn/trade-cards` },
  openGraph: {
    type: "article",
    url: `${APP_URL}/learn/trade-cards`,
    title: "Reading the Trade Cards — Stamps, Status, and the Scan Hierarchy",
    description:
      "Anatomy of a Trade Card, what each stamp means, and the four-scan hierarchy that updates the cards through the day.",
  },
};

export default function Page() {
  return (
    <LearnPageScaffold
      title="Reading the Trade Cards — Stamps, Status, and the Scan Hierarchy"
      lead="Each card on the TRADE CARDS tab represents the current authoritative plan for one ticker on the active trading day. The plan flows through four scans — premarket sets it, market-open revises if conditions changed at the open, analysis comments mid-morning, and settlement stamps the post-close outcome. The card you see is always the merged result of every scan published so far."
      slug="trade-cards"
      faqs={[
        {
          question: "What does each card represent?",
          answer:
            "One ticker's authoritative trade plan for the day. The card shows strike, direction, entry zone, entry trigger, targets, stop, time-stop, and rationale. As the day progresses and later scans publish, the card auto-updates — there's only ever one card per ticker per day, never duplicates.",
        },
        {
          question: "What do the corner stamps mean?",
          answer:
            "The diagonal rubber-stamp overlay shows the post-close verdict. Green stamps (T1 Hit, T2 Hit) are wins — the option premium reached the target before hitting the stop. Red stamps (Stopped) are losses. Grey stamps (No Fill, Time Stop, Manual Exit) are neither — the trade didn't execute fully or got cut by a time-stop rule. Killed is a separate red stamp on cards where a later scan invalidated the setup before it could execute.",
        },
        {
          question: "What's the difference between Confirmed, Revised, Killed, and Added status?",
          answer:
            "Confirmed = the plan from premarket stands, no later scan changed it. Revised = a later scan (usually market-open) changed one or more fields — strike, entry, stop, etc. Expand the 'Changed from premarket' diff to see exactly what shifted. Killed = a later scan invalidated the trade with a reason before it could execute (often 'gap closed', 'setup invalidated'). Added = the trade wasn't in the premarket plan but a later scan introduced it (e.g. a fresh opportunity at the open).",
        },
        {
          question: "What does the 'Updated · 9:45' badge mean?",
          answer:
            "A small amber chip in the card header. It means the market-open scan (which runs at 9:45 AM ET) modified this trade after the open — usually a revised entry zone or tightened stop based on the actual opening drive. The 'Changed from premarket' diff below the metrics shows exactly which fields changed.",
        },
        {
          question: "Why are some cards struck-through with a 'Killed' banner?",
          answer:
            "A later scan invalidated the trade plan. Reasons: the underlying gapped past the entry zone before the entry trigger could fire, a key level was breached pre-open, news that changed the thesis, or the original setup just didn't materialize. The kill reason is shown in the red banner. The card stays visible so you can audit what was killed and why — not silently dropped.",
        },
        {
          question: "What does the outcome footer below the rationale show?",
          answer:
            "When settlement publishes (around 4:15 PM ET), every executed trade gets an outcome footer: actual entry fill price, actual exit price, and a Result line explaining what happened ('Target 1 hit +50%', 'Stopped −42%', 'No fill — option never traded in entry zone', etc.). The footer color matches the stamp tone — green for wins, red for losses, grey for no-action outcomes.",
        },
        {
          question: "What do high / medium / low confidence mean on the outcome?",
          answer:
            "The settlement engine computes outcomes by walking Tradier 5-minute option premium bars and checking against the plan. Confidence = high means a clear single exit event with ample bars. Medium = a close call (e.g. target and stop touched in the same bar — engine took the conservative reading). Low = the engine had to fall back on a sanity clamp because the bar data looked anomalous; the LLM commentary usually explains what happened.",
        },
        {
          question: "What's the session scorecard at the top of the tab?",
          answer:
            "Once the post-close settlement scan has stamped outcomes, the scorecard banner shows the day's net P&L%, W-L tally, win rate, and any no-fills / time-stops / killed counts. Before settlement runs (pre-close), the scorecard shows a placeholder 'Awaiting outcome stamps from the post-close analysis scan' — that's normal.",
        },
        {
          question: "Why is there a 'No Fill' stamp on a card?",
          answer:
            "The option premium never traded inside the planned entry zone during the session. Common causes: the underlying gapped past the entry trigger before fills were possible, the trigger never fired (e.g. 'break of 5-min low' but the underlying never broke), or the option was illiquid and didn't print in the zone. The result_notes commentary usually explains which.",
        },
        {
          question: "What's a Time Stop and when does it fire?",
          answer:
            "A time-stop is a hard exit time written into the original plan (e.g. '11:30 AM ET if not at T1'). The settlement engine fires the time-stop when the bar's ET clock crosses that threshold AND the trade hasn't already hit a target or stop. The exit is taken at the close of the time-stop bar. Time-stops protect against directional trades that just chop sideways — the option bleeds theta whether the trade is right or wrong, and a half-day of indecision is usually worth cutting.",
        },
      ]}
      related={[
        { slug: "scorecard", title: "Scorecard — Tracking Performance Over Time" },
        { slug: "0dte-options", title: "What is 0DTE Options Trading?" },
        { slug: "weekly-research", title: "Weekly Research Stack" },
        { slug: "gamma-exposure", title: "Gamma Exposure (GEX)" },
      ]}
    >
      <h2>Anatomy of a card, top to bottom</h2>
      <ol>
        <li>
          <strong>Header row.</strong> Ticker (large), direction chip
          (Call/Put/Long/Short), rank, optional &ldquo;Updated&rdquo; or
          &ldquo;Added&rdquo; badge, and the grade chip on the right (A+ down to F).
        </li>
        <li>
          <strong>Killed banner</strong> (only on killed cards). A red strip
          under the header explaining why a later scan invalidated the trade.
        </li>
        <li>
          <strong>Metrics grid.</strong> Strike, Expiry, Entry zone, Target 1,
          Target 2, Stop, Time stop. Numbers are option-premium dollars; targets
          show the +% gain implied; stop shows the −% loss implied.
        </li>
        <li>
          <strong>Changed from premarket</strong> (revised cards only). A
          collapsible diff list — old value (struck-through red) → new value
          (green). Click the summary to expand.
        </li>
        <li>
          <strong>Entry Trigger.</strong> The conditional that must fire before
          the trade is taken. Usually a price level + a confirming signal
          (&ldquo;break of opening 5-min low after 9:35; SPY confirming red&rdquo;).
          The rubber-stamp lives inside this section.
        </li>
        <li>
          <strong>Rationale.</strong> One-paragraph explanation of why this
          setup made the grade — open interest, spread, delta, recent flow.
        </li>
        <li>
          <strong>Outcome footer.</strong> Post-close result — actual fill
          price, exit price, and the verdict label with P&amp;L%. Color-coded.
        </li>
      </ol>

      <h2>The four-scan hierarchy</h2>
      <p>
        Each scan can confirm, revise, or kill the previous plan. Later scans
        override earlier ones; silence in a later scan means &ldquo;no
        change&rdquo; (the premarket plan stands).
      </p>
      <ul>
        <li>
          <strong>Premarket (8:30 AM ET).</strong> Sets the original plan for
          every flagged ticker. Grade, strike, entry zone, targets, stop,
          rationale.
        </li>
        <li>
          <strong>Market-Open (9:45 AM ET).</strong> Re-grades after the opening
          drive. Can revise entry zones (e.g. premium moved), tighten stops, or
          kill trades whose setup was invalidated by the open. New intraday
          opportunities can be Added here.
        </li>
        <li>
          <strong>Analysis (10:15 AM ET).</strong> Comparative narrative — what
          the open implied vs the premarket bias. Mostly commentary; can also
          revise / kill trades mid-morning.
        </li>
        <li>
          <strong>Settlement (4:15 PM ET).</strong> Post-close. A deterministic
          engine walks 5-minute option premium bars for every executed trade and
          stamps the outcome: target hit, stopped, no-fill, time-stopped. LLM
          commentary adds tape color but doesn&apos;t override the structured
          verdict.
        </li>
      </ul>

      <h2>Stamp legend</h2>
      <ul>
        <li>
          <strong>T1 Hit / T2 Hit (green).</strong> Premium reached the target
          before hitting the stop. T2 = the bigger target. The number shows
          P&amp;L% from actual fill to target.
        </li>
        <li>
          <strong>Stopped (red).</strong> Premium hit the stop before any target
          fired. P&amp;L% is the loss from fill to stop.
        </li>
        <li>
          <strong>No Fill (grey).</strong> Entry never executed. The option
          premium didn&apos;t trade in the entry zone during the session.
        </li>
        <li>
          <strong>Time Stop (amber).</strong> Trade was still open when the
          planned time-stop fired. Exit at the close of the time-stop bar.
        </li>
        <li>
          <strong>Manual Exit (neutral).</strong> Trade was still open at the
          4:00 PM close. Marked-to-close. Color follows the P&amp;L sign.
        </li>
        <li>
          <strong>Killed (red, no P&amp;L).</strong> Plan was invalidated before
          execution by a later scan. Card is greyed and struck through.
        </li>
      </ul>

      <h2>Why a card might be missing a stamp</h2>
      <p>
        Stamps only appear after the post-close settlement scan publishes. Pre-close
        (i.e. between 8:30 AM and ~4:15 PM ET), cards show the plan only — no
        outcome yet. The session scorecard banner will say &ldquo;Awaiting
        outcome stamps from the post-close analysis scan&rdquo; until settlement
        runs. That&apos;s normal, not a bug.
      </p>
    </LearnPageScaffold>
  );
}
