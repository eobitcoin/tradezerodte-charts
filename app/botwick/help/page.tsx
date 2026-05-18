import Link from "next/link";
import { redirect } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

function H2({ children, id }: { children: React.ReactNode; id: string }) {
  return (
    <h2
      id={id}
      className="text-lg font-semibold tracking-tight pt-6 mt-2 border-t border-black/10 dark:border-white/10 first:border-t-0 first:pt-0 first:mt-0"
    >
      {children}
    </h2>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-semibold tracking-tight mt-5 mb-1">{children}</h3>;
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1 py-0.5 rounded bg-black/[0.06] dark:bg-white/[0.08] text-[0.9em] font-mono">
      {children}
    </code>
  );
}

function Note({ children, kind = "info" }: { children: React.ReactNode; kind?: "info" | "warn" }) {
  const cls =
    kind === "warn"
      ? "border-amber-500/30 bg-amber-500/[0.07]"
      : "border-emerald-500/30 bg-emerald-500/[0.05]";
  return <div className={`rounded-lg border ${cls} px-3 py-2 text-sm my-3`}>{children}</div>;
}

function Pre({ children }: { children: React.ReactNode }) {
  return (
    <pre className="bg-black/[0.04] dark:bg-white/[0.05] rounded px-3 py-2 text-xs overflow-x-auto font-mono">
      {children}
    </pre>
  );
}

export default async function BotWickHelpPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/botwick/help");

  return (
    <>
      <SiteHeader />
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">BotWick — How it works</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            The ALMA × VWAP strategy rules, the full bot lifecycle, and how each signal
            translates into a real order at Tradier. Includes the safety rails that prevent
            duplicate / orphaned orders.
          </p>
          <div className="text-sm">
            <Link href="/botwick" className="underline">
              ← Back to BotWick
            </Link>
          </div>
        </header>

        <nav className="rounded-lg border border-black/10 dark:border-white/10 px-4 py-3 text-sm max-w-3xl">
          <div className="text-xs uppercase tracking-wide text-black/55 dark:text-white/55 mb-2">
            Contents
          </div>
          <ul className="space-y-1">
            <li><a className="hover:underline" href="#overview">1. Overview — what BotWick is</a></li>
            <li><a className="hover:underline" href="#lifecycle">2. Trade lifecycle states</a></li>
            <li><a className="hover:underline" href="#alma-math">3. ALMA + VWAP — the indicator math</a></li>
            <li><a className="hover:underline" href="#alma-rules">4. ALMA strategy rules — arming &amp; pullback</a></li>
            <li><a className="hover:underline" href="#alma-config">5. ALMA tuning knobs in CONFIG</a></li>
            <li><a className="hover:underline" href="#tradier-adapter">6. Tradier REST integration</a></li>
            <li><a className="hover:underline" href="#gate">7. The four-of-four safety gate</a></li>
            <li><a className="hover:underline" href="#tick">8. The monitor tick — phase by phase</a></li>
            <li><a className="hover:underline" href="#submit">9. How a signal becomes a Tradier order</a></li>
            <li><a className="hover:underline" href="#reconcile">10. Reconciliation &amp; fills</a></li>
            <li><a className="hover:underline" href="#repeg">11. Smart re-pegging</a></li>
            <li><a className="hover:underline" href="#exits">12. Exit submission</a></li>
            <li><a className="hover:underline" href="#alma939">13. Option 2 — ALMA 9/39 RSI strategy (trailing stop + TP1–TP5)</a></li>
            <li><a className="hover:underline" href="#force-exit">14. Force-exit at 15:55 ET</a></li>
            <li><a className="hover:underline" href="#broker-reconcile">15. Broker-side reconciliation</a></li>
            <li><a className="hover:underline" href="#rails">16. Safety rails summary</a></li>
            <li><a className="hover:underline" href="#example">17. Worked example — end-to-end trace</a></li>
          </ul>
        </nav>

        <article className="prose prose-neutral dark:prose-invert max-w-3xl">
          <H2 id="overview">1. Overview — what BotWick is</H2>
          <p>
            BotWick is an automated trading bot integrated with the Tradier brokerage API.
            It runs two optional signal strategies, gated by an explicit four-of-four safety
            check, and routes every entry/exit through a single OMS layer with race-safe
            state transitions. Each strategy can independently trade <strong>0DTE options</strong>{" "}
            (the default) or <strong>shares of the underlying</strong> via a per-strategy
            Instrument toggle in CONFIG.
          </p>
          <ul>
            <li>
              <strong>Option 1 — ALMA × VWAP</strong>: pure technical signal. ALMA(9, 6, 0.85)
              crosses session VWAP on the 5-min chart, with entry on a confirmed pullback.
            </li>
            <li>
              <strong>Option 2 — ALMA 9/39 RSI Cross</strong>: ALMA(9) crossing ALMA(39) on
              the 5-min chart with RSI, Choppiness, VWAP and NY-session filters. Owns its own
              exit logic: fixed or trailing stop on underlying, plus TP1–TP5 scale-out. See{" "}
              <a className="underline" href="#alma939">section 13</a>.
            </li>
          </ul>
          <p>
            <strong>Instrument modes</strong> (per strategy):
          </p>
          <ul>
            <li><Code>options</Code> (default) — buys nearest OTM call on LONG signals, OTM put on SHORT.</li>
            <li><Code>stock_long</Code> — buys shares on LONG signals; SHORT signals skip-with-warning.</li>
            <li><Code>stock_short</Code> — short-sells shares on SHORT signals; LONG signals skip-with-warning. Requires a margin account at Tradier.</li>
            <li><Code>stock_both</Code> — buys on LONG, short-sells on SHORT. Requires margin.</li>
          </ul>
          <p>
            Same signal logic in every mode — only the asset bought and the sizing math
            differ. Exits (stop, trailing, TP1–TP5, ALMA/VWAP, force-close at 15:55 ET) work
            identically on share qty.
          </p>
          <p>
            This page covers both strategies and how every signal converts into a real Tradier
            order. The retired plan-based strategies (older Option 2 / Option 3) are no longer
            selectable in the admin UI.
          </p>

          <H2 id="lifecycle">2. Trade lifecycle states</H2>
          <p>
            Every trade lives in <Code>bot_trades</Code> with one of these statuses:
          </p>
          <ul>
            <li><Code>pending</Code> — ingested from a research post; waiting for entry trigger (plan-based only).</li>
            <li><Code>signal_armed</Code> — entry condition matched on underlying data.</li>
            <li><Code>signal_fired</Code> — armed AND passed the live re-risk-check; ready for OMS.</li>
            <li><Code>submitting</Code> — claim taken; about to POST to Tradier (race-safe gate).</li>
            <li><Code>working</Code> — order submitted, not yet filled.</li>
            <li><Code>open</Code> — filled; position is live.</li>
            <li><Code>closing</Code> — exit order submitted.</li>
            <li><Code>closed</Code> — fully closed; realized P&amp;L finalized.</li>
            <li><Code>rejected</Code> / <Code>cancelled</Code> / <Code>errored</Code> — terminal failure states.</li>
          </ul>
          <Note>
            ALMA-strategy trades skip <Code>pending</Code> and <Code>signal_armed</Code> — the
            signal itself <em>is</em> the entry condition, so the strategy inserts directly at
            <Code>signal_fired</Code>.
          </Note>

          <H2 id="alma-math">3. ALMA + VWAP — the indicator math</H2>

          <H3>ALMA(9, 6, 0.85)</H3>
          <p>
            Arnaud Legoux Moving Average on 5-min closes with these parameters:
          </p>
          <ul>
            <li><strong>length = 9</strong> — lookback bars</li>
            <li><strong>sigma = 6</strong> — Gaussian width (controls smoothing)</li>
            <li><strong>offset = 0.85</strong> — weight skew (closer to 1.0 emphasizes recent bars)</li>
          </ul>
          <p>
            ALMA is smoother than an EMA at the same length but lags less — well-suited to
            5-min charts where EMAs whipsaw too much. The strategy reads it on every closed
            5-min bar.
          </p>

          <H3>Session VWAP</H3>
          <p>
            Volume-weighted average price accumulated from the regular-session open (09:30 ET).
            Each bar contributes its typical price (Tradier&apos;s <Code>vwap</Code> field,
            falling back to <Code>(high+low+close)/3</Code>) weighted by the bar&apos;s volume.
            VWAP is the &quot;fair value&quot; line institutions watch.
          </p>

          <H3>Cross detection</H3>
          <p>
            Uses the sign of <Code>(ALMA − VWAP)</Code>. If the sign flips between two
            consecutive closed bars:
          </p>
          <Pre>{`prev < 0, curr > 0  →  "above"  (bullish cross)
prev > 0, curr < 0  →  "below"  (bearish cross)`}</Pre>
          <p>
            A small epsilon ignores near-zero deltas to suppress noise.
          </p>

          <H3>Slope steepness</H3>
          <p>
            <Code>slopePctPerBar = (currAlma − prevAlma) / prevAlma × 100</Code>. To arm a long
            we require <Code>slope ≥ +threshold</Code>; for short, <Code>slope ≤ −threshold</Code>.
            The threshold is <Code>CONFIG → Steep slope threshold</Code> (default 0.05%).
          </p>

          <H2 id="alma-rules">4. ALMA strategy rules — arming &amp; pullback</H2>
          <p>Per ticker, per 5-min tick, the strategy walks:</p>
          <ol>
            <li>Pull session bars (09:30 → now), drop the still-printing current bar.</li>
            <li>Compute ALMA + VWAP at the latest two closed bars.</li>
            <li>Detect cross. If steep enough → arm <Code>bot_alma_state(side, readyAt, ...)</Code>.</li>
            <li>Walk back through the recent bars looking for a pullback to ALMA.</li>
            <li>On first pullback → branch on <Code>almaInstrumentMode</Code> (see below) to pick the asset, size the order, insert <Code>bot_trades(status=signal_fired)</Code>.</li>
          </ol>

          <H3>Instrument modes (options vs stock)</H3>
          <p>
            The signal + arming + pullback logic is identical regardless of instrument. The
            only thing that changes is what the bot buys at step 5:
          </p>
          <ul>
            <li>
              <strong><Code>options</Code></strong> (default) — picks the nearest OTM call
              (long) or put (short) at <Code>currentPrice</Code>, sizes via{" "}
              <Code>floor(min(positionSize, maxRiskPerTrade) / (mid × 100))</Code>, submits a
              LIMIT-at-mid order. Re-pegs up to <Code>entryRepegMax</Code> times if the mid
              moves.
            </li>
            <li>
              <strong><Code>stock_long</Code></strong> — MARKET buy on the underlying for LONG
              pullbacks; SHORT pullbacks skip-with-warning. Qty = <Code>floor(maxStockNotional / underlyingPrice)</Code>,
              capped at submit by Tradier&apos;s reported stock buying power.
            </li>
            <li>
              <strong><Code>stock_short</Code></strong> — MARKET <Code>sell_short</Code> on
              SHORT pullbacks; LONG pullbacks skip. Requires a margin account; cash accounts
              are rejected pre-submit with a clean tape error.
            </li>
            <li>
              <strong><Code>stock_both</Code></strong> — Both sides fire. Useful when you want
              the same ALMA × VWAP signal trading the underlying long <em>and</em> short on
              the same watchlist.
            </li>
          </ul>
          <p>
            All exits (Target1/Target2/Stop/Time-stop, optional ALMA-reversal, optional
            Price-Reversal ALMA) work identically on share qty in stock modes. Stock exits
            always go MARKET; only the option path uses limit-at-mid + re-peg. Long stock
            exits route to <Code>sell</Code>; short stock exits route to <Code>buy_to_cover</Code>.
          </p>

          <H3>Pullback &quot;band&quot; — not just a touch</H3>
          <p>For LONG, a bar qualifies as a pullback when:</p>
          <Pre>{`bar.low ≤ ALMA                            (wick reached ALMA from above)
bar.low ≥ ALMA × (1 − thresholdPct/100)   (wick not deeper than threshold)`}</Pre>
          <p>
            For SHORT — symmetric (<Code>bar.high ≥ ALMA</Code> AND{" "}
            <Code>bar.high ≤ ALMA × (1 + thresh/100)</Code>).
          </p>
          <p>
            The wick must <strong>reach</strong> ALMA — a shallow pullback doesn&apos;t qualify.
            But a wick deeper than the threshold is treated as a real reversal, not a buyable
            dip. <Code>CONFIG → Pullback band threshold</Code> (default 0.10%) sets the floor.
          </p>

          <H3>Cool-down window</H3>
          <p>
            <Code>CONFIG → Pullback cool-down</Code> (default 5 bars). For the first N bars
            after arming, the strategy <strong>tolerates close-below-VWAP</strong>. Whippy
            bars where price briefly drops back under VWAP don&apos;t clear READY — we wait
            through the chop and only fire on the first band-qualifying pullback. After
            cool-down, the standard guard returns: a close re-crossing VWAP wipes READY.
          </p>

          <H3>Same-bar firing</H3>
          <p>
            A bar that both crosses VWAP AND wicks down to ALMA in a single candle fires entry
            on that bar — no need to wait for a separate pullback bar. Matches typical
            TradingView single-bar confirmation.
          </p>

          <H3>Walk-back through recent bars</H3>
          <p>
            Each tick re-examines up to <Code>max(6, coolDownBars + 1)</Code> recent bars
            since arming, computing ALMA + VWAP at each bar&apos;s own index. The first bar
            to satisfy the band fires entry — so a pullback that occurred between cron ticks
            still triggers on the next tick.
          </p>

          <H3>READY state lifecycle</H3>
          <p>
            <Code>bot_alma_state</Code> holds one row per armed ticker. It clears when:
          </p>
          <ul>
            <li>A pullback fires (deleted after the trade is inserted)</li>
            <li>The latest close re-crosses VWAP <em>after</em> cool-down expires</li>
            <li>An opposite-direction cross arrives (new cross wipes the old)</li>
            <li>The 15:55 force-exit sweep runs</li>
            <li>An admin clicks <strong>Reset &amp; Archive</strong> on CONFIG</li>
          </ul>

          <H2 id="alma-config">5. ALMA tuning knobs in CONFIG</H2>
          <ul>
            <li><strong>Watchlist</strong> — tickers the ALMA scanner watches each tick (up to 20). Used by Options 1 &amp; 3.</li>
            <li><strong>Steep slope threshold</strong> — minimum ALMA slope (% per bar) to arm. Default 0.05%. Lower = more setups, more noise.</li>
            <li><strong>Pullback cool-down (bars)</strong> — protective window where close re-crossing VWAP doesn&apos;t clear READY. Default 5.</li>
            <li><strong>Pullback band threshold (% of ALMA)</strong> — max wick depth beyond ALMA that still counts as a buyable dip. Default 0.10%.</li>
            <li><strong>ALMA reversal exit</strong> — opt-in. Fires when the <em>ALMA line itself</em> crosses VWAP against the position. See <a className="underline" href="#exits">section 12</a>.</li>
            <li><strong>Price-Reversal ALMA exit</strong> — opt-in. Earlier signal than ALMA reversal: fires on the <em>bar close</em> moving past ALMA ± threshold. Has its own threshold (default 0.05%) and grace period (default 5 bars after fill). See <a className="underline" href="#exits">section 12</a>.</li>
          </ul>

          <H2 id="tradier-adapter">6. Tradier REST integration</H2>
          <p>
            One module (<Code>lib/botwick/tradier-adapter.ts</Code>) owns every HTTP call.
            Endpoints in use:
          </p>
          <ul>
            <li><Code>POST /accounts/{"{id}"}/orders</Code> — submit an order (option, limit or market)</li>
            <li><Code>DELETE /accounts/{"{id}"}/orders/{"{id}"}</Code> — cancel</li>
            <li><Code>GET /accounts/{"{id}"}/orders/{"{id}"}</Code> — single order status</li>
            <li><Code>GET /accounts/{"{id}"}/orders</Code> — all orders for broker-reconcile</li>
            <li><Code>GET /accounts/{"{id}"}/balances</Code> — equity, cash, day P&amp;L</li>
            <li><Code>GET /accounts/{"{id}"}/positions</Code> — open positions</li>
            <li><Code>GET /accounts/{"{id}"}/gainloss</Code> — realized P&amp;L per closed position</li>
            <li><Code>GET /markets/quotes</Code> — underlying + option quotes</li>
            <li><Code>GET /markets/options/chains</Code> — option chain by expiry</li>
            <li><Code>GET /markets/timesales</Code> — 5-min bars</li>
          </ul>

          <H3>Mode routing</H3>
          <ul>
            <li><Code>mode=paper</Code> → orders route to <strong>sandbox</strong>, market data prefers <strong>production</strong> (real-time) if the live token is set, otherwise sandbox (15-min delayed).</li>
            <li><Code>mode=live</Code> → orders <em>and</em> data both production.</li>
            <li><Code>mode=off</Code> → all Tradier calls refuse with <Code>mode_off</Code>.</li>
          </ul>

          <H3>Error contract</H3>
          <p>
            Every adapter function returns <Code>{`{ok: true, data}`}</Code> or{" "}
            <Code>{`{ok: false, code, reason}`}</Code> — never throws. Callers pattern-match
            and surface errors to the tape with structured codes (<Code>auth</Code>,{" "}
            <Code>network</Code>, <Code>rate_limited</Code>, <Code>bad_response</Code>,{" "}
            <Code>server_error</Code>, <Code>mode_off</Code>, <Code>no_token</Code>).
          </p>

          <H2 id="gate">7. The four-of-four safety gate</H2>
          <p>
            Re-checked at the <strong>moment</strong> of every submit (entry, exit, repeg) —
            cheap insurance against an admin flipping a setting mid-tick:
          </p>
          <ol>
            <li><Code>!killSwitchEngaged</Code></li>
            <li><Code>enabled === true</Code></li>
            <li><Code>mode !== &quot;off&quot;</Code></li>
            <li>If <Code>mode === &quot;live&quot;</Code> then <Code>liveOrdersConfirmed === true</Code> (paper bypasses this)</li>
          </ol>
          <p>Any single failure → submit aborts with a clear code, no Tradier call is made.</p>

          <H2 id="tick">8. The monitor tick — phase by phase</H2>
          <p>
            Runs every 5 min via Railway cron, wrapped in a <strong>Postgres advisory lock</strong>{" "}
            so two concurrent ticks cannot run simultaneously. If another tick already holds
            the lock, the new one bails immediately.
          </p>
          <Pre>{`Phase 0   Force-exit sweep (15:55–15:59 ET only)
Phase A   Per-ticker entry latch — pending → signal_armed (plan-based)
Phase ALMA  runAlmaVwapCross — inserts new signal_fired rows
Phase B   Live re-check + Option-3 ALMA gate — signal_armed → signal_fired
Phase B2  Broker-side reconcile — stuck-submitting recovery, orphan detection
Phase C   submitAllFired — signal_fired → submitting → working
Phase D   reconcileWorkingOrders — working → open, closing → closed
Phase D2  repegStaleWorkingOrders — cancel + re-price unfilled entries
Phase E   processOpenExitsForTicker — open → closing on target/stop/time/reversal`}</Pre>

          <H2 id="submit">9. How a signal becomes a Tradier order</H2>
          <p>
            Every entry passes through a <strong>3-step state machine</strong> to keep DB and
            broker in sync even if the process crashes mid-flight.
          </p>

          <H3>Step 1 — CLAIM (atomic)</H3>
          <Pre>{`UPDATE bot_trades
   SET status='submitting', submittingAt=now()
 WHERE id=? AND status='signal_fired'
RETURNING id`}</Pre>
          <p>
            If 0 rows return, another writer claimed it — we skip silently. This is the
            race-safe gate that makes concurrent ticks safe even if the advisory lock somehow
            leaked.
          </p>

          <H3>Step 2 — POST</H3>
          <ul>
            <li>Re-check the four-of-four gate</li>
            <li>Resolve OCC symbol from the trade&apos;s leg</li>
            <li>Fetch <strong>live mid quote</strong> for the option: <Code>(bid + ask) / 2</Code>, falling back to last</li>
            <li>
              <strong>Submit-time sizing</strong> — the single golden source for every strategy:
              <Pre>{`budget = min(positionSizeUsd, maxRiskPerTradeUsd)
qty    = floor(budget / (live_mid × 100))`}</Pre>
            </li>
            <li>Reject <Code>qty = 0</Code> as <Code>size_zero</Code></li>
            <li>POST to Tradier:</li>
          </ul>
          <Pre>{`class:         option
side:          buy_to_open
type:          limit
price:         live_mid (rounded to $0.01)
duration:      day
quantity:      computed qty
option_symbol: OCC`}</Pre>

          <H3>Step 3 — COMMIT</H3>
          <ul>
            <li>
              <strong>POST success</strong> →{" "}
              <Code>UPDATE submitting → working, tradierOrderId=&lt;id&gt;, submittedAt=now()</Code>,
              and patch <Code>leg.qty</Code> so the audit reflects what was actually sent.
            </li>
            <li>
              <strong>POST failure</strong> → <Code>UPDATE submitting → signal_fired</Code>{" "}
              (release the claim so the next tick retries).
            </li>
            <li>
              If the process dies between Step 1 and Step 3, the row sits in{" "}
              <Code>submitting</Code> — see section{" "}
              <a className="underline" href="#broker-reconcile">14</a> for recovery.
            </li>
          </ul>

          <H2 id="reconcile">10. Reconciliation &amp; fills</H2>
          <p>
            <Code>reconcileWorkingOrders</Code> polls each <Code>working</Code> and{" "}
            <Code>closing</Code> row&apos;s Tradier order status, then maps:
          </p>
          <ul>
            <li><Code>filled</Code> → <Code>open</Code> (entry) or <Code>closed</Code> (exit). Records <Code>entryFillUsd</Code> or <Code>realizedPnlUsd</Code>.</li>
            <li><Code>partially_filled</Code> → unchanged, keep polling.</li>
            <li><Code>canceled</Code> / <Code>expired</Code> → <Code>cancelled</Code>, set <Code>closedAt</Code>.</li>
            <li><Code>rejected</Code> → <Code>rejected</Code>, tape entry with rejection reason.</li>
            <li><Code>error</Code> → <Code>errored</Code>, manual review.</li>
          </ul>
          <p>
            P&amp;L formula: <Code>(exit_fill − entry_fill) × 100 × qty</Code>. Stored in{" "}
            <Code>realizedPnlUsd</Code> as a numeric.
          </p>

          <H2 id="repeg">11. Smart re-pegging</H2>
          <p>
            Entry orders that sit unfilled for one tick (~5 min) get re-priced. Controlled by{" "}
            <Code>CONFIG → entryRepegMax</Code> (default 2):
          </p>
          <ul>
            <li><strong>Attempt 1</strong>: cancel + resubmit at current mid (the market has moved since first submit)</li>
            <li><strong>Attempt 2</strong>: cancel + resubmit at mid + 1 cent (worsened slightly)</li>
            <li><strong>After max attempts</strong>: <strong>cross the spread</strong> with a MARKET order so the trade actually starts</li>
          </ul>
          <p>
            Each repeg increments <Code>repegCount</Code> on the trade row. Setting{" "}
            <Code>entryRepegMax = 0</Code> disables re-pegging.
          </p>

          <H2 id="exits">12. Exit submission</H2>
          <p>
            For every <Code>open</Code> position, the OMS evaluates the trade&apos;s exit AST
            (<Code>plan.ast</Code>) on every tick. ALMA-strategy trades get a default AST
            synthesized from <Code>CONFIG → Default exits</Code>; plan-based trades use the
            plan&apos;s parsed exits with config defaults filling any null branches.
          </p>
          <p>
            <strong>Order types per exit branch:</strong>
          </p>
          <ul>
            <li><strong>Target 1 / Target 2</strong> → LIMIT sell_to_close at live mid</li>
            <li><strong>Stop loss</strong> → <strong>MARKET</strong> sell_to_close</li>
            <li><strong>Time stop</strong> → <strong>MARKET</strong> sell_to_close</li>
            <li><strong>ALMA reversal</strong> (opt-in) → <strong>MARKET</strong> sell_to_close</li>
            <li><strong>Price-Reversal ALMA exit</strong> (opt-in) → <strong>MARKET</strong> sell_to_close</li>
          </ul>
          <p>
            <strong>Priority order:</strong>{" "}
            <Code>stop &gt; alma_break &gt; reversal &gt; target &gt; time_stop</Code> — whichever
            fires first wins. The two ALMA-based exits can both be on at the same time;
            <Code>alma_break</Code> always preempts <Code>reversal</Code> because it&apos;s the
            earlier signal.
          </p>

          <H3>Price-Reversal ALMA exit — how it works</H3>
          <p>
            The standard <strong>ALMA reversal</strong> exit waits for the ALMA line itself to
            cross VWAP against the position. That&apos;s a slow signal — by the time the smoothed
            ALMA average flips, price has often moved meaningfully past your stop. The
            Price-Reversal ALMA exit fires earlier: it watches the <em>bar close</em> moving
            directly past the ALMA line by a configurable threshold.
          </p>
          <Pre>{`LONG  → bar.close < ALMA × (1 − threshold/100)   ⇒ exit
SHORT → bar.close > ALMA × (1 + threshold/100)   ⇒ exit`}</Pre>
          <p>
            Both checks fire on a <strong>fully closed 5-min bar</strong> (in-progress bars are
            dropped). On match → MARKET <Code>sell_to_close</Code>, same priority slot as the
            standard ALMA reversal (one wins, the earlier match preempts).
          </p>

          <H3>Grace period — letting the trade breathe</H3>
          <p>
            Without a grace period, a fresh trade can be killed on the very next bar if price
            briefly wicks back through ALMA. The <strong>Don&apos;t exit for (# of bars)</strong>{" "}
            knob suppresses the Price-Reversal exit for the first N bars after fill, giving the
            setup time to develop.
          </p>
          <Pre>{`Fill at 14:30:00 ET → graceBars = 5 (default)

  Bar 14:30 (fill bar):  grace → exit SKIPPED
  Bar 14:35:             grace → exit SKIPPED
  Bar 14:40:             grace → exit SKIPPED
  Bar 14:45:             grace → exit SKIPPED
  Bar 14:50:             grace → exit SKIPPED     (5 bars elapsed)
  Bar 14:55 onwards:     ACTIVE  ✓  — exit fires if close breaks ALMA ± threshold`}</Pre>
          <p>
            Math: <Code>barsSinceFill = floor((now − filledAt) / 5 min)</Code>. When{" "}
            <Code>barsSinceFill &lt; graceBars</Code>, the check returns matched=false with reason
            &quot;grace&quot;. Set graceBars to <Code>0</Code> to disable the grace period and
            check from the first bar after fill.
          </p>
          <Note>
            The grace period applies <strong>only</strong> to the Price-Reversal ALMA exit. Stop,
            target, time-stop, and the standard ALMA reversal exits are <strong>not</strong>{" "}
            suppressed — your hard stop will still fire instantly if hit during the grace window.
            The grace exists to prevent <em>over-eager early-exit-on-noise</em>, not to disable
            risk control.
          </Note>

          <H3>Picking the threshold + grace</H3>
          <ul>
            <li><strong>Threshold 0.05% (default)</strong> — ~$0.20 band on a $400 underlying. Roughly one tick of normal bar noise; exits at the first sign of mean-reversion.</li>
            <li><strong>Threshold 0.10–0.15%</strong> — more forgiving. Waits for a clearer break.</li>
            <li><strong>Threshold 0.20%+</strong> — very loose. Requires a clean directional break before exiting.</li>
            <li><strong>Grace 5 (default)</strong> — ~25 min after fill. Balances &quot;let it breathe&quot; with &quot;don&apos;t hold a loser too long.&quot;</li>
            <li><strong>Grace 3-4</strong> — tighter, for fast-moving signals where 25 min is too patient.</li>
            <li><strong>Grace 8-10</strong> — looser, gives trades a half-hour-plus before this exit can fire.</li>
            <li><strong>Grace 0</strong> — exit can fire on the very next bar after fill. Use with conservative threshold (0.10%+) or you&apos;ll get whipped out frequently.</li>
          </ul>

          <H3>When to enable Price-Reversal vs ALMA Reversal</H3>
          <ul>
            <li><strong>Price-Reversal only</strong> — most reactive setup. Earliest possible exit when the trend signal breaks. Best when premium decay is high (deep 0DTE afternoons) and every minute of wrong-side hold costs you.</li>
            <li><strong>ALMA Reversal only</strong> — slower, smoother. Waits for ALMA itself to flip — fewer false exits but bigger drawdowns when the trade actually reverses.</li>
            <li><strong>Both on</strong> — Price-Reversal fires first; ALMA Reversal acts as a backup if for some reason Price-Reversal misses (e.g., during its grace window the ALMA itself crosses).</li>
            <li><strong>Neither</strong> — pure target/stop/time exits. Strategy-defined risk only.</li>
          </ul>

          <H2 id="alma939">13. Option 2 — ALMA 9/39 RSI strategy</H2>
          <p>
            Option 2 is a separate technical strategy that ports a TradingView PineScript setup:
            ALMA(fast) crossing ALMA(slow) on the 5-min chart, filtered by RSI, Choppiness Index,
            session VWAP, and NY trading hours. Defaults: fast=9, slow=39, offset=0.85, sigma=6.
            It owns its own exit logic — the standard AST / ALMA-reversal / Price-Reversal flow
            in <a className="underline" href="#exits">section 12</a> does <em>not</em> apply to
            Option 2 trades.
          </p>

          <H3>Entry — LONG (calls)</H3>
          <p>
            On the latest closed 5-min bar, ALL of these must be true:
          </p>
          <ul>
            <li>ALMA9 crosses <strong>above</strong> ALMA39 this bar (Pine-style cross detection).</li>
            <li>RSI within configured long band (default <Code>50 – 72</Code>).</li>
            <li>Choppiness Index on the configured side of threshold (default <Code>≤ 50</Code> = trending).</li>
            <li>Close (or HL2, configurable) <strong>above</strong> session VWAP.</li>
            <li>Inside the NY entry session (default <Code>09:30 – 16:00</Code>).</li>
            <li>Before the configured force-close cutoff (default <Code>15:55</Code>).</li>
            <li>No existing in-flight trade for this ticker.</li>
          </ul>

          <H3>Entry — SHORT (puts)</H3>
          <p>
            Symmetric: ALMA9 crosses <strong>below</strong> ALMA39, RSI in short band
            (default <Code>28 – 50</Code>), price <strong>below</strong> VWAP. Bot buys the
            nearest OTM PUT — same sizing math as the call path.
          </p>

          <H3>Order sizing — golden source</H3>
          <p>
            <strong>Options mode:</strong> <Code>floor(min(positionSize, maxRiskPerTrade) / (live_mid × 100))</Code>.
            On signal fire the bot records <Code>originalQty</Code> and <Code>entryUnderlying</Code> on
            <Code>plan.runtime</Code> — these are immutable for the life of the trade so partial-close
            scale-out math stays stable even after earlier TPs reduce the leg qty.
          </p>
          <p>
            <strong>Stock modes (any of <Code>stock_long</Code> / <Code>stock_short</Code> / <Code>stock_both</Code>):</strong>{" "}
            <Code>qty = floor(maxStockNotional / underlyingPrice)</Code> at signal time, then re-capped
            at submit-time against Tradier&apos;s reported stock buying power. <Code>maxStockNotional</Code>{" "}
            lives in CONFIG → Risk caps (separate from <Code>maxRiskPerTrade</Code> because $1k of
            options ≠ $1k of shares — linear vs leveraged exposure). Same <Code>originalQty</Code> /{" "}
            <Code>entryUnderlying</Code> snapshot is taken so TPs scale out a fixed % of the original
            share count even after earlier partials fire.
          </p>

          <H3>Stock modes — what changes vs options</H3>
          <p>
            The signal logic (cross detection, RSI/Chop/VWAP filters, session gates) and all exit
            machinery (fixed/trailing stop, TP1–TP5 scale-out, ALMA/VWAP exits, force-close at
            15:55 ET) are <em>identical</em> across all four instrument modes. Only the entry/exit
            order shape diverges. Per-mode behavior:
          </p>
          <ul>
            <li>
              <strong><Code>stock_long</Code></strong> — On LONG cross: MARKET buy on the
              underlying. SHORT crosses log a <Code>risk_block</Code> tape entry and skip
              (no position is opened).
            </li>
            <li>
              <strong><Code>stock_short</Code></strong> — On SHORT cross: MARKET <Code>sell_short</Code>{" "}
              on the underlying. LONG crosses skip-with-warning. Requires a Tradier margin account;
              cash accounts are rejected pre-submit with a clean error before any order goes out.
            </li>
            <li>
              <strong><Code>stock_both</Code></strong> — Both sides fire. Single bot can run a
              long-and-short rotation on the same watchlist symbol throughout the day.
            </li>
          </ul>
          <p>
            Entries and exits both go MARKET in stock modes. Limit-at-mid offers no edge on liquid
            equities (spreads are typically a penny or two), and missed limit fills can bleed away
            the win we just earned on the underlying move. Re-pegging logic is option-only and is
            never engaged for stock trades.
          </p>

          <H3>Stock exits — long vs short routing</H3>
          <p>
            The OMS detects short positions via <Code>trade.strategy === &quot;short_stock&quot;</Code>{" "}
            (set at signal time alongside <Code>leg.side = sell_short</Code>) and routes exits
            accordingly:
          </p>
          <ul>
            <li><strong>Long stock exit</strong> → <Code>sell</Code> equity order.</li>
            <li><strong>Short stock exit</strong> → <Code>buy_to_cover</Code> equity order.</li>
          </ul>
          <p>
            Every exit path uses this routing: TP partial closes, full-close on final TP, stop
            (fixed or trailing), ALMA/VWAP exits, force-close at 15:55, and the admin
            manual-close button.
          </p>

          <H3>PDT awareness (non-blocking)</H3>
          <p>
            At every stock entry the bot pulls Tradier balances and checks{" "}
            <Code>total_equity</Code> + <Code>account_type</Code>. If equity is under $25,000 on a
            margin or PDT-flagged account, a <Code>risk_block</Code>-severity tape entry fires
            warning that intraday round-trips count toward FINRA&apos;s 4-in-5-day pattern-day-trader
            limit. The entry still goes through — this is a heads-up, not a block.
          </p>

          <H3>Per-trade snapshot — why a mid-trade config change is safe</H3>
          <p>
            When the entry fires, the strategy snapshots the entire exit-config block (stop mode,
            trail %, anchor, all five TP levels with enable/pct/qty) onto <Code>plan.strategyExits</Code>.
            Every exit check reads from this snapshot, not from the live <Code>bot_config</Code>.
            Consequence: if you flip a setting mid-day, in-flight trades keep the rules they were
            born with — only <em>new</em> entries pick up the new config. No surprise re-arming of
            a stop in the middle of a position.
          </p>

          <H3>Exit priority order</H3>
          <p>The strategy evaluates exits in this order; first match wins, every exit is MARKET sell_to_close:</p>
          <ol>
            <li><strong>Force-close at 15:55 ET</strong> — BotWick day-trade sweep (see <a className="underline" href="#force-exit">section 14</a>). Catches everything regardless of other exits.</li>
            <li><strong>Stop loss</strong> — fixed % from entry, OR trailing % with a moving anchor. Tick-priced AND bar-close-priced (see below).</li>
            <li><strong>TP1 → TP5</strong> — each enabled level scales out its configured Qty % of <em>original</em> position when underlying reaches the % from entry. Levels are scanned ascending; the last enabled level always full-closes the remainder.</li>
            <li><strong>ALMA exits (optional)</strong> — close vs ALMA39, ALMA9 × ALMA39 cross against position.</li>
            <li><strong>VWAP exits (optional)</strong> — close vs VWAP, ALMA9 × VWAP cross with close confirming.</li>
          </ol>

          <H3>Stop loss — Fixed mode</H3>
          <p>
            Simplest stop. On every tick, the strategy compares live underlying to a fixed level
            computed from entry:
          </p>
          <ul>
            <li>LONG: <Code>stopLevel = entryUnderlying × (1 − fixedSlPct / 100)</Code></li>
            <li>SHORT: <Code>stopLevel = entryUnderlying × (1 + fixedSlPct / 100)</Code></li>
          </ul>
          <p>
            If underlying breaches, a MARKET sell_to_close fires for the full remaining qty
            (cancels any remaining TPs by definition — the leg is gone).
          </p>

          <H3>Stop loss — Trailing mode</H3>
          <p>
            Trailing stop only ever moves in the favorable direction (up for longs, down for
            shorts) and is <strong>floored</strong> at the fixed-SL distance from entry until
            price has moved past that floor. Think of it as: <em>start with the fixed stop;
            once you&apos;re comfortably in profit, the trail takes over</em>.
          </p>
          <p>
            Three anchor modes control which bar/price drives the trail:
          </p>
          <ul>
            <li>
              <strong>Prev bar extreme</strong> (Pine default) — anchor is the highest high (long)
              or lowest low (short) over closed bars <em>before</em> the bar being evaluated.
              Mirrors Pine&apos;s <Code>[1]</Code> semantic. Most resistant to wick-driven
              false trails.
            </li>
            <li>
              <strong>Current bar extreme</strong> — includes the current closed bar&apos;s
              high/low. Faster to ratchet, more vulnerable to single-wick noise.
            </li>
            <li>
              <strong>Closes only</strong> — uses bar closes (max for long, min for short).
              Smoothest trail; lags but ignores wicks entirely.
            </li>
          </ul>
          <p>
            Formula: <Code>trailStop = anchor × (1 − trailSlPct / 100)</Code> for long
            (<Code>(1 + …)</Code> for short). On each bar, the candidate is computed and the
            stop only replaces the existing one if it&apos;s more favorable. The trail level
            is persisted in <Code>plan.runtime.trailingStop</Code>, so it survives bot
            restarts.
          </p>
          <p>
            The trailing stop is checked two ways every tick:
          </p>
          <ul>
            <li><strong>Tick price</strong> — between bar closes, live underlying vs the most recent <Code>plan.runtime.trailingStop</Code>.</li>
            <li><strong>Bar close</strong> — after a new 5-min bar lands, the trail recomputes and the bar&apos;s close is checked against it.</li>
          </ul>

          <H3>Profit targets — TP1 → TP5 scale-out</H3>
          <p>
            Each enabled level fires once. On a hit, the bot submits a MARKET sell_to_close for a
            slice of <em>original</em> position size:
          </p>
          <pre className="text-xs"><code>{`sliceQty = ceil(originalQty × tpQtyPct / 100)
         clamped to remaining qty`}</code></pre>
          <ul>
            <li><strong>Partial close</strong> — trade stays in <Code>open</Code>. Leg qty is reduced; the level is recorded in <Code>plan.runtime.tpsFiredAt</Code> so the next tick won&apos;t re-fire it.</li>
            <li><strong>Final-level full close</strong> — the highest-numbered enabled level (e.g., TP5 if all are on, or TP3 if 4 and 5 are off) always full-closes whatever&apos;s left, even if its own qty% would say otherwise. This prevents fractional leftover slivers.</li>
            <li><strong>Gap protection</strong> — TPs are scanned ascending each tick. If price gaps past two levels at once, the lower one fires this tick and the higher one fires the next tick. No level is silently skipped.</li>
            <li><strong>Stop preempts remaining TPs</strong> — if the stop hits while TPs are partially fired, the remaining qty full-closes via the stop. The unfired levels do not get a second chance.</li>
          </ul>
          <p>
            Defaults: TP1 +0.50%, TP2 +1.00%, TP3 +1.50%, TP4 +2.00%, TP5 +2.50% — each at 20%
            qty. So in the typical case the original position is scaled out across all five
            levels evenly.
          </p>

          <H3>ALMA + VWAP exits (optional)</H3>
          <p>
            Layered on top of stop+TP. These fire a full MARKET close — they bypass the TP
            ladder entirely because they signal a structural reversal. The exact rules
            (close vs ALMA39, ALMA9 × ALMA39 cross, close vs VWAP, ALMA9 × VWAP cross) are
            individually toggleable for long and short in CONFIG. Read{" "}
            <a className="underline" href="#exits">section 12</a> for the urgency model; the same
            ordering principle applies (structural reversal &gt; trend exhaustion &gt; profit-taking).
          </p>

          <H3>Tuning guidance</H3>
          <ul>
            <li><strong>Tighter trailing (≤ 0.5%)</strong> — protects gains aggressively, but in chop you&apos;ll trail-stop out of trades that would&apos;ve worked. Best in strong-trend regimes.</li>
            <li><strong>Wider trailing (≥ 1.5%)</strong> — gives the trade more rope. Pairs well with all 5 TPs enabled, since the bot will scale out incrementally while the trail loosely backstops the rest.</li>
            <li><strong>Fewer TPs (e.g., TP1 + TP5 only)</strong> — &quot;take some off, let the rest run&quot;. Configure TP1 at +0.5% / 50% qty and TP5 at +2.5% / 50% qty.</li>
            <li><strong>All-or-nothing</strong> — disable all TPs and rely solely on the trailing stop + ALMA/VWAP exits. Highest variance but captures full multi-bar runs.</li>
          </ul>

          <H2 id="force-exit">14. Force-exit at 15:55 ET</H2>
          <p>
            Day-trade safety net. Runs at 15:55–15:59 ET every weekday when{" "}
            <Code>dayTradeForceExit=true</Code> (default). Sweeps everything by 16:00:
          </p>
          <ul>
            <li><Code>pending</Code> / <Code>signal_armed</Code> → local cancel (no Tradier action needed)</li>
            <li><Code>submitting</Code> / <Code>working</Code> → cancel the Tradier order + mark cancelled</li>
            <li><Code>open</Code> → MARKET sell_to_close</li>
            <li><Code>closing</Code> → replace the existing limit with a MARKET order (catches stale limit-at-mid exits)</li>
          </ul>

          <H2 id="broker-reconcile">15. Broker-side reconciliation</H2>
          <p>
            Runs every tick (Phase B2). Cross-checks DB state against Tradier&apos;s
            authoritative view. Catches three drift classes:
          </p>
          <ol>
            <li>
              <strong>Stuck submitting recovery</strong> — rows with{" "}
              <Code>submittingAt &lt; now() − 60s</Code>. The reconciler queries Tradier&apos;s
              order list, matches by OCC + side + qty:
              <ul>
                <li><strong>Found</strong> → attach <Code>tradierOrderId</Code>, transition <Code>submitting → working</Code></li>
                <li><strong>Not found</strong> → release the claim, <Code>submitting → signal_fired</Code> for retry next tick</li>
              </ul>
            </li>
            <li>
              <strong>Orphan orders</strong> — Tradier order IDs not tracked in DB → tape
              warning (NOT auto-cancelled; the account may be used for manual trades too).
            </li>
            <li>
              <strong>Orphan positions</strong> — Tradier positions with no matching DB trade →
              tape warning.
            </li>
          </ol>

          <H2 id="rails">16. Safety rails summary</H2>
          <ul>
            <li><strong>Postgres advisory lock</strong> around every tick — two ticks cannot run concurrently.</li>
            <li><strong>Four-of-four gate</strong> at every submit — re-checked fresh from DB each time, not cached.</li>
            <li><strong>Atomic <Code>WHERE status=... RETURNING</Code></strong> for every state transition — race-safe by construction.</li>
            <li><strong>Submitting-status pattern</strong> (claim → POST → commit) — crashes between POST and DB commit are recoverable.</li>
            <li><strong>Broker-side reconcile</strong> — sweeps stuck submitting + detects drift on every tick.</li>
            <li><strong>Force-exit at 15:55 ET</strong> — safety net for day-trade rules and overnight risk.</li>
            <li><strong>Plan-slippage guard</strong> — live mid re-check before promoting <Code>signal_armed → signal_fired</Code>.</li>
            <li><strong>Reset &amp; Archive</strong> — admin one-click to clear the visible tape + READY state while preserving live trades and audit history.</li>
          </ul>

          <H2 id="example">17. Worked example — end-to-end trace</H2>
          <p>One ALMA trade, from arming to closed P&amp;L, across multiple ticks:</p>
          <Pre>{`Tick at 10:55
  └── runAlmaVwapCross(SPY)
      ├── Pull bars → detect cross on 10:55 bar
      ├── Slope 0.07% ≥ 0.05% → steep, ARM
      ├── Upsert bot_alma_state(side=long, readyAt=10:55:18)
      ├── Walk recent bars → 10:55 bar wick ≤ ALMA, in band → PULLBACK
      ├── Pick nearest OTM: SPY 437C, live mid $2.15
      ├── qty = floor(min(500, 300) / (2.15 × 100)) = 1
      ├── INSERT bot_trades(status=signal_fired, plan.ast=default exits)
      └── DELETE bot_alma_state(SPY)

Same tick, Phase C:
  └── submitAllFired
      ├── CLAIM: signal_fired → submitting (RETURNING ok)
      ├── submitEntryOrder
      │   ├── 4-of-4 gate ✓
      │   ├── Live mid → $2.18 (3¢ drift since strategy ran)
      │   ├── qty recompute: floor(300 / (2.18 × 100)) = 1
      │   └── POST Tradier { buy_to_open SPY437C ×1 @ $2.18 limit day }
      └── COMMIT: submitting → working with tradierOrderId=12345

Tick at 11:00, Phase D:
  └── reconcileWorkingOrders
      └── Tradier says order 12345 = filled at $2.17
          → status: open, entryFillUsd=$217

Tick at 11:15, Phase E:
  └── processOpenExitsForTicker
      └── Option mid hit +50% (entry $2.17 → now $3.26)
      └── Target1 fires → POST sell_to_close LIMIT @ $3.26
          → status: closing

Tick at 11:20, Phase D:
  └── reconcileWorkingOrders
      └── Exit filled at $3.27
          → status: closed, realizedPnlUsd = (3.27 − 2.17) × 100 × 1 = $110`}</Pre>
          <Note>
            That&apos;s the full chain. Anywhere it could break — concurrent ticks, mid-flight
            crashes, Tradier 5xx, partial fills, stuck states — has a corresponding safety net
            from section <a className="underline" href="#rails">15</a> covering it.
          </Note>
        </article>
      </div>
    </>
  );
}
