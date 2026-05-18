import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import PolymarketTabs from "@/components/PolymarketTabs";

export const dynamic = "force-static";

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
  return (
    <div className={`rounded-lg border ${cls} px-3 py-2 text-sm my-3`}>{children}</div>
  );
}

export default function PolymarketHelpPage() {
  return (
    <>
      <SiteHeader />
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Polymarket</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            How to read the whale tracker, the wallet leaderboard, and the signals — and what
            NOT to read into them.
          </p>
        </header>
        <PolymarketTabs active="help" />

        {/* Table of contents */}
        <nav className="rounded-lg border border-black/10 dark:border-white/10 px-4 py-3 text-sm">
          <div className="text-xs uppercase tracking-wide text-black/55 dark:text-white/55 mb-2">
            Contents
          </div>
          <ul className="space-y-1">
            <li><a className="hover:underline" href="#orientation">1. Quick orientation — what each tab does</a></li>
            <li><a className="hover:underline" href="#live-whales">2. Live Whales — the firehose snapshot</a></li>
            <li><a className="hover:underline" href="#top-wallets">3. Top Wallets — how scoring works</a></li>
            <li><a className="hover:underline" href="#signals">4. Signals — convergence and top-wallet buys</a></li>
            <li><a className="hover:underline" href="#wallet-detail">5. Wallet detail — drilling into a trader</a></li>
            <li><a className="hover:underline" href="#data-sources">6. Data sources and freshness</a></li>
            <li><a className="hover:underline" href="#caveats">7. Honest caveats — what NOT to assume</a></li>
            <li><a className="hover:underline" href="#workflow">8. Suggested daily workflow</a></li>
            <li><a className="hover:underline" href="#limits">9. Known limits</a></li>
          </ul>
        </nav>

        <article className="prose prose-neutral dark:prose-invert max-w-3xl">
          <H2 id="orientation">1. Quick orientation</H2>
          <p>
            This dashboard tracks on-chain Polymarket prediction markets. Polymarket settles every
            trade on Polygon and exposes a public data feed, so trade history and wallet positions
            are observable without any account or API key. The four tabs:
          </p>
          <ul>
            <li><Link className="underline" href="/polymarket"><strong>Live Whales</strong></Link> — the most recent large trades, refreshed on each page load.</li>
            <li><Link className="underline" href="/polymarket/wallets"><strong>Top Wallets</strong></Link> — leaderboard of tracked wallets ranked by a composite score.</li>
            <li><Link className="underline" href="/polymarket/signals"><strong>Signals</strong></Link> — actionable view: convergence on shared bets plus fresh trades from high-scoring wallets.</li>
            <li><strong>Help</strong> — you are here.</li>
          </ul>
          <p>
            All four read from the same underlying data: a continuous record of whale-sized trades
            (≥&nbsp;$500), plus periodic re-scoring of every wallet that appears in that record.
          </p>

          <H2 id="live-whales">2. Live Whales — the firehose snapshot</H2>
          <p>
            Polymarket processes roughly 1,500 trades per minute. Most are tiny ($5–$50). This view
            scans the most recent few minutes of activity at page-load time and surfaces only the
            whale-sized ones. Each render is fresh — no cached data.
          </p>

          <H3>Filter controls</H3>
          <ul>
            <li><strong>Window</strong> (5m / 15m / 1h) — how far back to scan. Longer windows take longer to render.</li>
            <li><strong>Min size</strong> ($200 / $500 / $1K / $5K / $10K) — USD threshold. The default $500 already filters out about 99% of trades.</li>
          </ul>

          <H3>What to look for</H3>
          <ul>
            <li><strong>Amber-highlighted rows</strong> — trades ≥&nbsp;$10K. Rare and meaningful, typically structured plays rather than retail.</li>
            <li><strong>Repeat traders</strong> within the window — the same pseudonym appearing 3+ times often signals a structured strategy or an arbitrage. Click the trader name for the wallet detail page.</li>
            <li><strong>Same market, multiple sides</strong> — usually market-making or arbitrage, not directional conviction.</li>
            <li><strong>Buys near $0.99 or $0.05</strong> — usually settlement arbitrage on near-resolved markets, not predictive.</li>
          </ul>

          <Note kind="warn">
            Live Whales is a <em>snapshot</em>, not a long-running archive. To browse whale activity
            across hours or days, use the <strong>Signals</strong> tab — that view reads from the
            persistent trade history.
          </Note>

          <H2 id="top-wallets">3. Top Wallets — how scoring works</H2>
          <p>
            Every wallet that shows up in a whale trade gets added to the tracked roster. On a
            recurring cadence (each wallet re-scored at least every ~12 hours), realized and
            unrealized PnL are pulled from Polymarket and combined into a single composite score.
          </p>

          <H3>The composite score formula</H3>
          <p>
            <Code>compositeScore = ( 0.6 × signed log10(|realizedPnL|+1) + 0.4 × clamp(ROI%, ±50)/10 ) × min(positions/20, 1)</Code>
          </p>
          <p>What that is doing in plain terms:</p>
          <ul>
            <li>
              <strong>60% weight on PnL, log-scaled.</strong> A $100K winner counts about 5× a
              $1K winner, not 100×. Diminishing returns prevent whales-by-bankroll from dominating
              the ranking.
            </li>
            <li>
              <strong>40% weight on ROI, capped at ±50%.</strong> Capital efficiency matters, but
              one lucky 10× shouldn&apos;t crown a wallet. ROI is realized PnL divided by capital
              deployed.
            </li>
            <li>
              <strong>Multiplied by a sample-size factor</strong> = positions / 20, capped at 1.
              A wallet with 3 positions gets 15% of full score; a wallet with 20+ gets 100%. This
              neutralizes &quot;lucky on three bets&quot; effects.
            </li>
            <li>Wallets with fewer than 3 positions don&apos;t get a score at all — too noisy.</li>
          </ul>

          <H3>How to read the leaderboard columns</H3>
          <ul>
            <li><strong>Score</strong> — the composite. Above 1.0 is a genuinely strong track record. Above 1.5 is rare. Negative = consistent loser.</li>
            <li><strong>Realized</strong> — PnL from closed and settled positions. Most reliable column.</li>
            <li><strong>Unrealized</strong> — mark-to-market on open positions at the current Polymarket midpoint. Reflexive: a whale who moved a market will &quot;look profitable&quot; on it.</li>
            <li><strong>ROI</strong> — realized PnL divided by capital deployed. Clean efficiency metric, with caps to keep it stable.</li>
            <li><strong>Capital</strong> — total dollars deployed across positions Polymarket reports. Bigger generally indicates a more sophisticated player.</li>
            <li><strong>Pos</strong> — number of positions in the portfolio. Fewer than 5 is a small sample, treat with suspicion.</li>
            <li><strong>Volume</strong> — cumulative whale-trade volume observed for this wallet (≥&nbsp;$500 trades only) since it first appeared on the dashboard.</li>
            <li><strong>Scored</strong> — when the wallet was last re-scored.</li>
          </ul>

          <H3>What to actually do with this</H3>
          <ol>
            <li><strong>Sort mentally by Score.</strong> The top of the list is who to watch.</li>
            <li><strong>Check the Pos column</strong> — anything &lt; 10 is a tiny sample even if score is high. Wait for more data.</li>
            <li>
              <strong>Click a name</strong> to open the wallet detail page and see actual open
              positions. If a high-scorer is currently long a market you have a view on, that is
              a real signal.
            </li>
            <li>
              <strong>Don&apos;t copy-trade blindly.</strong> The leaderboard tells you who has
              been right historically; it does NOT predict who will be right next. Treat it as
              &quot;whose perspective is worth understanding,&quot; not &quot;whose trades to
              mirror.&quot;
            </li>
          </ol>

          <H2 id="signals">4. Signals — convergence and top-wallet buys</H2>
          <p>
            Signals is the actually-tradable view. It joins the persistent whale-trade history
            with the latest scoring data to surface two distinct signal types.
          </p>

          <H3>Convergence (top section)</H3>
          <p>
            <strong>Two or more wallets with composite score ≥ 0.5 entering the same market +
            outcome + side within the chosen window.</strong> Ranked by total USD volume.
          </p>
          <p>Why this matters:</p>
          <ul>
            <li>One whale buying could mean conviction, dumb money, or insider info — you can&apos;t tell.</li>
            <li>Two independent high-scorers buying the same side within hours is much harder to dismiss as random; they&apos;ve seen the same opportunity from different starting points.</li>
            <li>This is the cleanest tradable read on the page.</li>
          </ul>
          <p>
            <strong>Reading the row:</strong> market title, BUY/SELL pill, number of distinct
            wallets, total USD they put in collectively, average entry price, current Polymarket
            midpoint, time of first entry, and the wallets themselves with score badges. Click
            any wallet to drill in.
          </p>

          <H3>Top-Wallet Buys (below)</H3>
          <p>
            <strong>Single trades from wallets with score ≥ 1.0, USD ≥ $1K, within the last N
            hours.</strong> Ranked by <Code>compositeScore × usdValue</Code> — score-weighted size.
          </p>
          <p>
            This is the &quot;fresh ideas from people worth trusting&quot; feed. Less reliable
            than convergence (single wallet = single perspective) but useful for spotting
            opportunities a known sharp has acted on.
          </p>

          <H3>The &quot;Now&quot; column</H3>
          <p>
            For every signal, the current orderbook midpoint is fetched live at page-render time.
            Two pieces of information per row:
          </p>
          <ul>
            <li><strong>Top number</strong>: current midpoint (e.g. <Code>62.4¢</Code>)</li>
            <li><strong>Bottom number</strong>: delta vs the whale&apos;s entry, in cents (e.g. <Code>+3.2¢</Code> = price has moved 3.2¢ in their favor since entry)</li>
            <li><strong>Color</strong>: <span className="text-emerald-600 dark:text-emerald-400">green</span> = price moved past entry (whale already in profit), <span className="text-rose-600 dark:text-rose-400">rose</span> = market reverting against them</li>
          </ul>
          <p>
            <strong>How to interpret:</strong> a small green delta (<Code>+0–2¢</Code>) means
            you can still get in near where the whale got in. A large green delta
            (<Code>+5¢+</Code>) means the trade is largely &quot;done&quot; — the move has
            already played out. A rose delta means the market is fading the whale&apos;s entry —
            could be a better price OR a sign the whale was wrong. Use other context to decide.
          </p>

          <H3>Category filter</H3>
          <p>
            Categories (Politics / Crypto / Sports / Macro / etc.) are derived from Polymarket&apos;s
            tag system. Click a category pill to filter both sections to that vertical.
          </p>

          <H2 id="wallet-detail">5. Wallet detail — drilling into a trader</H2>
          <p>
            Click any wallet pseudonym (on Top Wallets or Signals) to see the full picture for
            that trader.
          </p>

          <H3>Score snapshot tiles</H3>
          <p>
            Six tiles at the top show the latest scoring metrics: composite score, realized PnL
            (color-coded), unrealized PnL, ROI, capital deployed, and position count.
          </p>

          <H3>Open positions table</H3>
          <p>
            <strong>Live from Polymarket</strong> — fetched fresh on every page render. Shows
            every open position the wallet currently holds, sorted by PnL (winners first):
          </p>
          <ul>
            <li><strong>Market · Outcome</strong> — link to the Polymarket event page</li>
            <li><strong>Size</strong> — number of shares held</li>
            <li><strong>Avg Px</strong> — volume-weighted average entry price, e.g. <Code>62.4¢</Code></li>
            <li><strong>Cur Px</strong> — current midpoint</li>
            <li><strong>Cost</strong> — capital deployed (size × avgPx)</li>
            <li><strong>Value</strong> — mark-to-market value</li>
            <li><strong>PnL</strong> — value − cost</li>
            <li><strong>PnL%</strong> — same, as a percentage</li>
            <li><strong>End</strong> — market resolution date</li>
            <li><strong>REDEEMABLE pill</strong> — appears on positions whose market has resolved and is awaiting payout claim</li>
          </ul>

          <H3>Recent whale trades</H3>
          <p>
            The last 30 trades on record for this wallet (≥&nbsp;$500 only). Useful for seeing
            how long a position has been building, or whether the wallet has been adding versus
            trimming.
          </p>

          <H2 id="data-sources">6. Data sources and freshness</H2>
          <p>All data comes from Polymarket&apos;s public endpoints. Nothing is scraped, no account is required.</p>
          <ul>
            <li><strong>Trades feed</strong> — the public stream of executed trades on Polygon. Sampled on a recurring cadence; whale-sized fills (≥&nbsp;$500) are persisted.</li>
            <li><strong>Wallet positions</strong> — current open positions and realized/unrealized PnL per wallet. Sampled per wallet roughly every 12 hours, used to refresh the score.</li>
            <li><strong>Event metadata</strong> — market titles, resolution dates, and tags (used for the category filter).</li>
            <li><strong>Orderbook midpoints</strong> — fetched live at page-render time on the Signals page to power the &quot;Now&quot; column.</li>
          </ul>

          <H3>How fresh is each tab?</H3>
          <ul>
            <li><strong>Live Whales</strong> — scans the very latest trades on every page load. Effectively real-time, bounded by Polymarket&apos;s feed latency.</li>
            <li><strong>Top Wallets</strong> — scoring metrics are at most ~12 hours stale per wallet. The Scored column shows the exact age.</li>
            <li><strong>Signals</strong> — trades are persisted within minutes of execution. The &quot;Now&quot; column is fetched live on page render.</li>
            <li><strong>Wallet detail</strong> — open positions are fetched live; recent trades are from the persistent record.</li>
          </ul>

          <Note>
            The leaderboard becomes most useful after the dashboard has been running long enough
            to have observed thousands of wallets across hundreds of resolved markets. Early on,
            small samples mean lucky-streak noise dominates — weight rankings accordingly.
          </Note>

          <H2 id="caveats">7. Honest caveats — what NOT to assume</H2>
          <ul>
            <li>
              <strong>Score ≠ alpha.</strong> Scoring is retrospective. Historically right does
              not mean correct on the next trade. Treat scores as &quot;whose perspective is
              worth understanding,&quot; not &quot;copy this trade.&quot;
            </li>
            <li>
              <strong>Unrealized PnL is reflexive.</strong> Whales who move markets see their
              open positions mark up automatically. The cleanest signal is realized PnL on
              resolved markets — that&apos;s actual money on closed bets.
            </li>
            <li>
              <strong>Convergence isn&apos;t entry timing.</strong> By the time a convergence signal
              fires, price has often already moved 2–5 cents. Use the Now column to gauge whether
              the trade is still entry-able.
            </li>
            <li>
              <strong>The roster is incomplete.</strong> Only wallets that have done a whale trade
              in the observed window are tracked. Sharp traders who never cross the $500 threshold
              won&apos;t appear.
            </li>
            <li>
              <strong>Market-making vs directional.</strong> Some &quot;top wallets&quot; might be
              market-makers capturing spread rather than expressing directional conviction. If a
              wallet trades both sides of the same market within a short window, treat their PnL
              as MM revenue, not predictive edge.
            </li>
            <li>
              <strong>Resolution risk.</strong> Polymarket markets occasionally have ambiguous
              resolution criteria. A wallet looking right for weeks can lose on a technicality.
              Read each market&apos;s resolution rules before sizing.
            </li>
            <li>
              <strong>Liquidity matters.</strong> Many Polymarket markets have very thin
              orderbooks. A signal you can&apos;t actually fill at the visible price isn&apos;t a
              tradable signal.
            </li>
          </ul>

          <H2 id="workflow">8. Suggested daily workflow</H2>
          <ol>
            <li>
              <strong>Open the Signals tab.</strong> Default 24h window, no category filter. Scan
              the top 5 convergence rows. For each, check the Now column — if delta is small,
              it&apos;s still entry-able.
            </li>
            <li>
              <strong>Click into the markets that interest you.</strong> Read the resolution rules
              on Polymarket. Confirm the question is unambiguous. Check orderbook depth.
            </li>
            <li>
              <strong>Click into one of the convergent wallets.</strong> Look at their other open
              positions for context — are they all-in on this theme, or is this one of many bets?
            </li>
            <li>
              <strong>Cross-reference with Top-Wallet Buys.</strong> Sometimes solo high-scorers
              are early to themes that haven&apos;t hit convergence yet.
            </li>
            <li>
              <strong>Skip if any of:</strong> resolution criteria are vague, orderbook is &lt;
              $5K depth, the high-scorer&apos;s sample is small, or the price has already moved
              5+ cents past their entry.
            </li>
          </ol>

          <H2 id="limits">9. Known limits</H2>
          <ul>
            <li>
              <strong>No alerts yet.</strong> The dashboard is pull-only — refresh to see new
              signals. There is no push notification when a high-confidence convergence fires.
            </li>
            <li>
              <strong>No per-market drill-down.</strong> You can&apos;t yet open a market and see
              every tracked wallet that has a position in it.
            </li>
            <li>
              <strong>Categories are flat.</strong> Sub-category filters (NFL within Sports, Fed
              within Macro) are not exposed in the UI.
            </li>
            <li>
              <strong>No score history.</strong> Each wallet shows its current score, not how that
              score has trended over time.
            </li>
            <li>
              <strong>No automatic market-maker filter.</strong> You may need to spot MM-style
              wallets manually by looking for two-sided activity in their recent trades.
            </li>
          </ul>
        </article>
      </div>
    </>
  );
}
