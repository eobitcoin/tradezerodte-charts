import Link from "next/link";
import { redirect } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic"; // admin-gated

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

export default async function BacktestHelpPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/botwick/backtest/help");
  if (user.role !== "admin") redirect("/botwick");

  return (
    <>
      <SiteHeader />
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Backtest — Help</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            How the ALMA × VWAP backtest works, what every input does, how to read the output, and
            what the model assumes vs. what it can&apos;t see.
          </p>
          <div className="text-sm">
            <Link href="/botwick?tab=backtest" className="underline">
              ← Back to Backtest
            </Link>
          </div>
        </header>

        <nav className="rounded-lg border border-black/10 dark:border-white/10 px-4 py-3 text-sm max-w-3xl">
          <div className="text-xs uppercase tracking-wide text-black/55 dark:text-white/55 mb-2">
            Contents
          </div>
          <ul className="space-y-1">
            <li><a className="hover:underline" href="#what">1. What the backtest actually does</a></li>
            <li><a className="hover:underline" href="#inputs-core">2. Core inputs (From / To / Tickers / Slope)</a></li>
            <li><a className="hover:underline" href="#inputs-policy">3. Exit policy inputs (Target / Stop / Time / Leverage ×)</a></li>
            <li><a className="hover:underline" href="#leverage">4. Understanding the leverage multiplier</a></li>
            <li><a className="hover:underline" href="#summary-grid">5. The summary grid — directional metrics</a></li>
            <li><a className="hover:underline" href="#policy-grid">6. The P&L grid — option-dollar estimates</a></li>
            <li><a className="hover:underline" href="#per-ticker">7. Per-ticker table</a></li>
            <li><a className="hover:underline" href="#signals-table">8. Signals table — column by column</a></li>
            <li><a className="hover:underline" href="#errors">9. Errors and skipped days</a></li>
            <li><a className="hover:underline" href="#workflow">10. Suggested workflow</a></li>
            <li><a className="hover:underline" href="#assumptions">11. What the model assumes</a></li>
            <li><a className="hover:underline" href="#limits">12. What the model can&apos;t see</a></li>
          </ul>
        </nav>

        <article className="prose prose-neutral dark:prose-invert max-w-3xl">
          <H2 id="what">1. What the backtest actually does</H2>
          <p>
            For every <strong>ticker × trading day</strong> in the requested range, the engine:
          </p>
          <ol>
            <li>Pulls historical 5-min bars from Tradier (RTH only: 09:30–16:00 ET).</li>
            <li>Walks the bars in order. At each closed bar, computes ALMA(9, 6, 0.85) and session VWAP.</li>
            <li>When ALMA crosses VWAP <em>with a steep enough slope</em>, the strategy goes into <Code>READY</Code> state for that direction.</li>
            <li>On the first subsequent bar where price pulls back to ALMA while holding the VWAP side, a <strong>signal fires</strong>.</li>
            <li>The forward bars are then walked again to record outcomes: did the underlying touch the nearest OTM strike, what was the best favorable / worst adverse move, and (since the P&L estimator was added) when would the exit policy have triggered.</li>
          </ol>
          <p>
            One signal per ticker per day, max. Each signal becomes one row in the results table.
          </p>
          <Note>
            The backtest reuses the <em>exact</em> live-bot logic for cross detection, slope
            steepness, and pullback — so a clean result here is genuine read on the strategy, not a
            different model that happens to share a name.
          </Note>

          <H2 id="inputs-core">2. Core inputs</H2>

          <H3>From / To (dates)</H3>
          <p>
            Inclusive ET trading-day range. Weekends are skipped automatically. Holidays and
            half-days show up as &quot;not enough bars&quot; in the errors section. Today is allowed
            — bars are capped at the current ET clock, and pre-market days are skipped with a
            clear reason.
          </p>

          <H3>Tickers</H3>
          <p>
            Comma- or whitespace-separated. Defaults to your CONFIG → ALMA × VWAP watchlist when
            blank. SPY / QQQ are the most reliable here because Tradier provides clean 5-min data
            and large-cap chains hit the synthetic OTM grid cleanly. Single-name tickers work but
            can be noisier.
          </p>

          <H3>Slope threshold (% / bar)</H3>
          <p>
            The minimum ALMA slope (per 5-min bar, as a percent of price) required to consider a
            cross &quot;steep enough&quot; to arm <Code>READY</Code>. Same field that appears in the
            CONFIG tab — the backtest is the place to tune it before pushing the change to live.
          </p>
          <ul>
            <li><strong>0.03–0.05</strong> — permissive, catches more setups, more chop noise.</li>
            <li><strong>0.06–0.10</strong> — moderate, the typical SPY/QQQ default zone.</li>
            <li><strong>0.12+</strong> — aggressive, only the cleanest momentum crosses survive.</li>
          </ul>

          <H2 id="inputs-policy">3. Exit-policy inputs</H2>
          <p>
            These define how the simulator turns a fired signal into a P&L outcome. Defaults are
            pulled from your live CONFIG so the backtest answers &quot;what would have happened
            with my current settings.&quot; Override any of them to sensitivity-test.
          </p>

          <H3>Target 1 (%)</H3>
          <p>
            The option-premium gain at which the trade exits with a win. Expressed in option terms,
            not underlying terms. Example: <Code>50</Code> means &quot;exit when the option is worth
            50% more than entry.&quot; The simulator never partial-exits — it&apos;s all-or-nothing
            at T1 in the backtest (the &quot;Target 2 ever&quot; column tells you whether a runner
            <em>would have</em> hit a higher stretch level).
          </p>

          <H3>Stop loss (%)</H3>
          <p>
            The option-premium loss at which the trade exits with a loss. Positive number — e.g.
            <Code>50</Code> means &quot;exit when option is worth 50% less than entry.&quot;
          </p>

          <H3>Time stop (minutes)</H3>
          <p>
            Max hold time from entry. If neither target nor stop hits in this window, the trade
            exits at whatever the current option mark is (which can be positive or negative). On 5-min
            bars, this rounds to the next 5-minute boundary after the cutoff.
          </p>

          <H3>Leverage × (option / underlying)</H3>
          <p>
            The assumed option-% move per 1% move in the underlying. See{" "}
            <a className="underline" href="#leverage">section 4</a> for how to choose this.
          </p>

          <H2 id="leverage">4. Understanding the leverage multiplier</H2>
          <p>
            The simulator doesn&apos;t have historical option chain prices, so it estimates option
            P&L from the underlying&apos;s path using a single constant:
          </p>
          <pre className="bg-black/[0.04] dark:bg-white/[0.05] rounded px-3 py-2 text-xs">
            optionPct = underlyingPct × leverageMultiplier
          </pre>
          <p>For 0DTE <em>nearest-OTM</em> options on liquid index ETFs, this lands somewhere in 40–80×:</p>
          <ul>
            <li>SPY 5–10 minutes after open: ~60–80×</li>
            <li>Mid-morning (10:30 ET): ~40–60×</li>
            <li>After 14:00 ET, with theta accelerating: 30–50× and dropping fast</li>
          </ul>
          <p>
            The default is <strong>50</strong>. Higher = larger swings in both directions; lower =
            more conservative results. The honest move is to <em>sensitivity-test</em>: run the same
            window at <Code>40</Code>, <Code>50</Code>, <Code>60</Code> and see whether the
            conclusion (positive expected /trade vs. negative) is robust or knife-edge.
          </p>
          <Note kind="warn">
            Constant leverage is a <em>simplification</em>. Real 0DTE options gain leverage as they
            move ITM (delta climbs) and lose it as they expire OTM (delta decays). The model is
            directionally honest, not penny-accurate. Don&apos;t bring backtest dollar figures to a
            broker quote.
          </Note>

          <H2 id="summary-grid">5. The summary grid — directional metrics</H2>
          <p>
            The first five cells on the run card are a pure signal-quality read on the strategy.
            None of them depend on the exit policy.
          </p>
          <ul>
            <li>
              <strong>Signals</strong> — total signals fired in the window. Sub-line shows long /
              short count. Useful sanity check that the slope threshold isn&apos;t starving the
              strategy.
            </li>
            <li>
              <strong>Hit rate</strong> — % of signals where the underlying touched the nearest OTM
              strike at any point before close. &gt; 50% is a strong directional signal; 35–50% is
              workable with good exits; &lt; 35% means the signal is mostly noise. Sub-line splits L
              vs S so you can see if one direction is doing all the work.
            </li>
            <li>
              <strong>Avg favorable / Avg adverse</strong> — best and worst underlying excursion
              from entry, in %. Big favorable + small adverse = clean entries. Big adverse =
              pullback entries are catching falling knives.
            </li>
            <li>
              <strong>Time to touch</strong> — average minutes between signal and first strike-touch
              (computed only on signals that touched). Lower is better for 0DTE because theta
              accelerates as the clock runs out.
            </li>
          </ul>

          <H2 id="policy-grid">6. The P&L grid — option-dollar estimates</H2>
          <p>
            The second row of cells appears only when the simulator has run (every modern backtest).
            These translate the signal-quality numbers into a P&L view through the exit policy.
          </p>
          <ul>
            <li>
              <strong>Win rate</strong> — % of trades whose final exit was profitable (any exit
              reason — T1 hit, time stop with positive mark, end-of-day positive).
            </li>
            <li>
              <strong>Expected /trade</strong> — average option P&L % per trade. This is the
              headline. <strong>Positive = the strategy makes money on average</strong> at these
              settings. Negative = it bleeds, regardless of how good the hit rate looks.
            </li>
            <li>
              <strong>Avg win / Avg loss</strong> — payoff asymmetry. If avg win &gt; |avg loss|,
              you can survive a sub-50% win rate. With symmetric 50/50 sizing (T1 = stop), you need
              a real edge on the win-rate side.
            </li>
            <li>
              <strong>Target 1 hit</strong> — % of trades that exited at T1 (the cleanest win). The
              <Code>T2 ever</Code> sub-line shows how many would have hit a higher target — useful
              for deciding whether scaling out at T1 leaves money on the table.
            </li>
            <li>
              <strong>Stop / time / EOD</strong> — exit mix as percentages. High stop% = entries
              are getting fished; high time% = the time stop is too tight (or the strategy needs
              more patience); high EOD% = the time stop is too loose, you&apos;re holding to close.
            </li>
            <li>
              <strong>Sharpe-ish</strong> — mean P&L divided by standard deviation of P&L. Not a
              true Sharpe (we don&apos;t annualize for option holding periods), but a useful
              consistency proxy. &gt; 0.5 is decent; &gt; 1.0 is excellent for an unfiltered 0DTE
              strategy.
            </li>
          </ul>

          <H2 id="per-ticker">7. Per-ticker table</H2>
          <p>
            Same signal-quality metrics, sliced by symbol. The most common use is spotting that one
            ticker is carrying the whole edge (e.g. SPY 100%, QQQ 60%) — in which case the answer
            usually isn&apos;t &quot;drop QQQ&quot; but &quot;the slope threshold is wrong for
            QQQ.&quot;
          </p>

          <H2 id="signals-table">8. Signals table — column by column</H2>
          <p>Each row is one fired signal. The disclosure caps at 200 rows; longer runs show a count notice.</p>
          <ul>
            <li><strong>Day / ET</strong> — date and entry time (5-min bar close in ET).</li>
            <li><strong>Ticker / Side</strong> — symbol and direction.</li>
            <li><strong>Underlying</strong> — close price at the entry bar.</li>
            <li><strong>OTM</strong> — the synthetic nearest-OTM strike (snapped to a $1 / $2.50 / $5 grid based on price magnitude).</li>
            <li><strong>Slope %</strong> — measured ALMA slope at the cross bar. Negative for shorts. Should always be &gt; the configured threshold.</li>
            <li><strong>Touch</strong> — did the underlying reach the OTM strike at any point in the day&apos;s remaining bars?</li>
            <li><strong>T→touch</strong> — minutes from entry to first strike-touch.</li>
            <li><strong>Fav % / Adv %</strong> — best and worst underlying excursion (%).</li>
            <li><strong>Exit</strong> — which exit branch triggered: <Code>target1</Code> · <Code>stop_loss</Code> · <Code>time_stop</Code> · <Code>end_of_day</Code>.</li>
            <li><strong>@min</strong> — minutes from entry to exit.</li>
            <li><strong>Opt P&L</strong> — estimated option-premium P&L %. Color-coded green / red.</li>
          </ul>

          <H2 id="errors">9. Errors and skipped days</H2>
          <p>
            The Errors disclosure lists any ticker × day combo the engine couldn&apos;t process.
            Common reasons:
          </p>
          <ul>
            <li><Code>not enough bars</Code> — holiday, half-day, or new listing.</li>
            <li><Code>future date — no bars yet</Code> — dates after today.</li>
            <li><Code>today is pre-market — no bars yet</Code> — today before 09:30 ET.</li>
            <li><Code>Tradier 4xx</Code> — symbol not found / data plan limitation. Re-run later or check the symbol.</li>
          </ul>
          <p>
            None of these affect the summary metrics — skipped days are simply not counted. The bar
            in the errors list is informational.
          </p>

          <H2 id="workflow">10. Suggested workflow</H2>
          <ol>
            <li>
              <strong>Baseline run.</strong> Last 2 weeks of trading, your current ALMA watchlist,
              default slope and policy. Read the &quot;Expected /trade&quot; cell. If positive,
              that&apos;s your starting edge.
            </li>
            <li>
              <strong>Slope sensitivity.</strong> Re-run at slope = current ± 0.02 / ± 0.04. The
              point you&apos;re looking for is where signal count drops sharply <em>but</em>{" "}
              expected /trade stays flat or rises — that&apos;s the &quot;filter out chop&quot;
              sweet spot.
            </li>
            <li>
              <strong>Leverage sensitivity.</strong> Re-run baseline at leverage 40 and 60. If
              expected /trade goes from +10% → -5% as leverage drops, the edge is leverage-fragile
              and you should be skeptical.
            </li>
            <li>
              <strong>Policy A/B.</strong> Re-run with tighter target (e.g. 30%) and matching tighter
              stop (e.g. 30%). Compare win rate × avg win against the looser config — there&apos;s
              usually a clear winner per ticker.
            </li>
            <li>
              <strong>Per-ticker pruning.</strong> If a ticker has 6+ signals and a worse hit rate
              than the watchlist average, drop it from CONFIG → ALMA watchlist or push its slope
              threshold up separately (slope is global today; a per-ticker override is a future
              enhancement).
            </li>
            <li>
              <strong>Apply changes to CONFIG.</strong> Save the winning slope / policy values back
              to the live bot via the CONFIG tab. Re-run the backtest after the next 5 trading days
              to verify the prediction holds out of sample.
            </li>
          </ol>

          <H2 id="assumptions">11. What the model assumes</H2>
          <ul>
            <li>
              <strong>Constant leverage multiplier.</strong> No gamma / theta adjustment within a
              trade. Realistically, option leverage swells as you go ITM and collapses as you go
              OTM; the model treats them as the same number throughout.
            </li>
            <li>
              <strong>Conservative bar ordering.</strong> If a bar&apos;s range straddles both stop
              and target, the simulator attributes the stop. Real intraday paths are 50/50; this
              means the reported win rate slightly understates true edge.
            </li>
            <li>
              <strong>Fill at the close.</strong> Entry price = bar close, not bar mid or bid/ask.
              At signal generation moments, this is usually within a tick of reality but not
              always.
            </li>
            <li>
              <strong>Synthetic OTM grid.</strong> Strike picked from a $1 / $2.50 / $5 grid based
              on price magnitude. The real chain may have additional strikes (e.g. SPY has $0.50
              strikes near current price) — the model picks the nearest grid step, not the nearest
              listed strike.
            </li>
            <li>
              <strong>One signal per ticker per day.</strong> The bot today also follows this rule
              live, so the backtest matches. If you change live behavior to allow multiple
              re-arms per day, the backtest will need a matching update.
            </li>
          </ul>

          <H2 id="limits">12. What the model can&apos;t see</H2>
          <ul>
            <li>
              <strong>Slippage.</strong> Limit-at-mid in the live bot doesn&apos;t always fill at
              mid. The backtest assumes you got the mid for free.
            </li>
            <li>
              <strong>Commissions.</strong> Tradier commissions are zero on stocks but $0.35 per
              option contract per side. Not modeled. On small-account trading this can be 5–10% of
              the edge.
            </li>
            <li>
              <strong>Spread costs at entry.</strong> Wider spreads at low-OI strikes make the
              effective fill price worse than mid. Not modeled.
            </li>
            <li>
              <strong>IV crush around catalysts.</strong> A 1% favorable move into FOMC may yield a
              flat option P&L because IV collapsed. The model just multiplies underlying by
              leverage.
            </li>
            <li>
              <strong>The live re-check.</strong> The live bot also runs a plan-slippage guard at
              submit time — if the live mid has drifted too far from the plan, the trade is
              blocked. The backtest fires every signal that triggers, including those the live bot
              would have blocked.
            </li>
            <li>
              <strong>Account-level risk caps.</strong> Daily-loss kill switch, max open positions,
              etc. don&apos;t apply to the backtest — each signal is independent. Real cumulative
              P&L could be capped lower than the model suggests.
            </li>
          </ul>
          <Note>
            Net of these: the backtest tends to <em>slightly overstate</em> edge. Treat
            &quot;Expected /trade&quot; as a ceiling, not a forecast. A backtest that&apos;s only
            marginally positive after accounting for slippage + commissions probably isn&apos;t
            tradable; one that&apos;s comfortably positive at conservative leverage probably is.
          </Note>
        </article>
      </div>
    </>
  );
}
