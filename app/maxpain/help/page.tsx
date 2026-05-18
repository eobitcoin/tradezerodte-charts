import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import StocksTabs from "@/components/StocksTabs";

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

export default function MaxPainHelpPage() {
  return (
    <>
      <SiteHeader />
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <StocksTabs active="maxpain" />
        <header className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Max Pain &amp; Gamma Exposure</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            How to read the ticker sidebar, the four key levels, the GEX regime, and the alert
            stream — and how to use them when sizing a 0DTE trade.
          </p>
          <div className="text-sm">
            <Link href="/maxpain" className="underline">← Back to the latest scan</Link>
          </div>
        </header>

        {/* Table of contents */}
        <nav className="rounded-lg border border-black/10 dark:border-white/10 px-4 py-3 text-sm max-w-3xl">
          <div className="text-xs uppercase tracking-wide text-black/55 dark:text-white/55 mb-2">
            Contents
          </div>
          <ul className="space-y-1">
            <li><a className="hover:underline" href="#what-is">1. What Max Pain and GEX actually are</a></li>
            <li><a className="hover:underline" href="#sidebar">2. The ticker sidebar — groups, regimes, dots</a></li>
            <li><a className="hover:underline" href="#levels">3. The four key levels</a></li>
            <li><a className="hover:underline" href="#regimes">4. GEX regimes — POS, NEG, FLIP</a></li>
            <li><a className="hover:underline" href="#net-gex">5. Net GEX, Total GEX, and the &quot;per 1%&quot; unit</a></li>
            <li><a className="hover:underline" href="#alerts">6. Alerts — types and severity</a></li>
            <li><a className="hover:underline" href="#expirations">7. The expirations table</a></li>
            <li><a className="hover:underline" href="#tags">8. Tags — RETAIL, PIN, EST, STALE</a></li>
            <li><a className="hover:underline" href="#workflow">9. Suggested 0DTE workflow</a></li>
            <li><a className="hover:underline" href="#caveats">10. Honest caveats</a></li>
          </ul>
        </nav>

        <article className="prose prose-neutral dark:prose-invert max-w-3xl">
          <H2 id="what-is">1. What Max Pain and GEX actually are</H2>

          <H3>Max Pain</H3>
          <p>
            Max Pain is the strike price at which the total payout to option holders is minimized
            at expiration — equivalently, the strike that maximizes premium retained by sellers
            (typically dealers and institutional writers). It is computed by summing the intrinsic
            value of every open call and put at every candidate strike and picking the strike with
            the lowest total.
          </p>
          <p>
            <strong>Why it matters.</strong> Dealers who are short options have a continuous
            incentive to delta-hedge in a way that pulls spot toward Max Pain into expiration —
            this is the &quot;pinning&quot; effect. Max Pain is not a forecast of fair value; it
            is a description of where the open-interest weight sits.
          </p>

          <H3>Gamma Exposure (GEX)</H3>
          <p>
            GEX is the dollar change in dealer delta hedging required for a given move in spot.
            It is the second derivative of dealer P&amp;L — for every 1% spot moves, dealers must
            buy or sell <Code>$X</Code> of underlying to stay delta-neutral. The sign matters:
          </p>
          <ul>
            <li>
              <strong>Positive GEX</strong> → dealers buy when spot drops and sell when spot
              rises. This <em>damps</em> volatility. Markets in positive-gamma regimes tend to
              grind, with shallow pullbacks.
            </li>
            <li>
              <strong>Negative GEX</strong> → dealers sell when spot drops and buy when spot
              rises. This <em>amplifies</em> volatility. Negative-gamma regimes produce the
              violent intraday extensions and gap moves.
            </li>
          </ul>
          <p>
            The strike where dealer aggregate gamma flips sign is the <strong>zero-gamma flip</strong>.
            Spot relative to that flip is the single most useful piece of information on this page.
          </p>

          <H2 id="sidebar">2. The ticker sidebar — groups, regimes, dots</H2>
          <p>
            The left sidebar groups every scanned ticker into one of four categories.
          </p>
          <ul>
            <li><strong>Trading Focus</strong> — the day&apos;s actively-watched names (highest priority).</li>
            <li><strong>Pin-Friendly</strong> — tickers with strong historical pinning behavior into Friday/monthly expirations.</li>
            <li><strong>Index / Vol</strong> — broad-market and volatility products (SPX, SPY, QQQ, VIX, etc.).</li>
            <li><strong>Mega Cap</strong> — the largest single-name liquids that move the index.</li>
          </ul>

          <H3>Visual cues on each row</H3>
          <ul>
            <li><strong>Left border color</strong>: the ticker&apos;s GEX regime (green = POS, rose = NEG, amber = FLIP, gray = unknown).</li>
            <li><strong>Right pill</strong>: the regime label, repeated as text.</li>
            <li><strong>Spot price + Max Pain</strong> on the second line, with the % distance from spot to Max Pain in parentheses.</li>
            <li><strong>Small dot</strong>: severity of the highest active alert on that ticker — rose (HIGH), amber (MED), gray (LOW). No dot = no active alerts.</li>
            <li><strong>PIN badge</strong>: the ticker is on the pin-friendly list.</li>
            <li><strong>RET badge</strong>: the ticker has notable retail flow concentration.</li>
          </ul>

          <H2 id="levels">3. The four key levels</H2>
          <p>
            Every ticker shows four reference strikes as tiles at the top of the detail pane.
            Each tile shows the strike value and the % distance from spot (green if above spot,
            rose if below).
          </p>

          <H3>Max Pain</H3>
          <p>
            The pin-magnet strike for the front-month expiration. <strong>How to use it:</strong> if
            spot is within 0.5% of Max Pain on a high-OI Friday, expect a tight intraday range
            that drifts back to Max Pain into the close. If spot is &gt; 1.5% away, pinning is
            unlikely and the level is mostly a trivia point.
          </p>

          <H3>Zero-γ Flip</H3>
          <p>
            The strike where aggregate dealer gamma changes sign. <strong>How to use it:</strong>
          </p>
          <ul>
            <li><strong>Spot above flip</strong> → market is in positive-gamma territory → expect compression, mean-reversion, fading the wicks works.</li>
            <li><strong>Spot below flip</strong> → market is in negative-gamma territory → expect trending behavior, bigger ranges, momentum strategies work.</li>
            <li><strong>Spot within 0.3% of flip</strong> → the regime is unstable. Either side of the flip can be visited; positioning rapidly. This is where the riskiest fast moves happen.</li>
          </ul>

          <H3>Call Wall</H3>
          <p>
            The strike with the largest concentration of dealer-short call gamma above spot.
            Dealers must <em>sell</em> increasingly as spot approaches it, which acts as a
            magnet-then-resistance level. Spot rallies often stall at the call wall on the first
            test.
          </p>

          <H3>Put Wall</H3>
          <p>
            The strike with the largest concentration of dealer-short put gamma below spot. Acts
            as support: dealers buying support as spot pushes down. A clean break of the put wall
            is meaningful — it can trigger cascading hedge selling, especially in a negative-gamma
            regime.
          </p>

          <H2 id="regimes">4. GEX regimes — POS, NEG, FLIP</H2>
          <p>
            Each ticker is classified into one of three regimes based on where spot sits versus
            its zero-gamma flip and the magnitude of total dealer gamma.
          </p>

          <table>
            <thead>
              <tr>
                <th>Regime</th>
                <th>Behavior</th>
                <th>What works</th>
                <th>What doesn&apos;t</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>POS</strong> (green)</td>
                <td>Dealers long gamma. Vol-suppressive. Tight ranges, slow grind.</td>
                <td>Selling premium, fading wicks, iron condors.</td>
                <td>Buying calls/puts outright. Theta will eat you.</td>
              </tr>
              <tr>
                <td><strong>NEG</strong> (rose)</td>
                <td>Dealers short gamma. Vol-amplifying. Big ranges, trends extend.</td>
                <td>Buying directional options, momentum, trend-following.</td>
                <td>Selling premium without protection. One gap can ruin a month.</td>
              </tr>
              <tr>
                <td><strong>FLIP</strong> (amber)</td>
                <td>Spot near the gamma flip. Regime can change intraday.</td>
                <td>Patience. Wait for spot to commit one side of the flip.</td>
                <td>Sizing into either edge with confidence.</td>
              </tr>
            </tbody>
          </table>

          <Note>
            The regime is a property of the moment, not the day. A ticker can flip from POS to
            NEG mid-session if a meaningful directional move pushes spot through the flip
            strike. Watch the <Code>GAMMA_FLIP_CROSS</Code> alert.
          </Note>

          <H2 id="net-gex">5. Net GEX, Total GEX, and the &quot;per 1%&quot; unit</H2>
          <p>
            GEX figures on this page are denominated in <strong>dollars per 1% spot move</strong>.
            That is the standard convention: a Net GEX value of <Code>+$50M</Code> for an
            expiration means dealers must buy roughly $50M of underlying for every 1% spot
            <em> declines</em>, and sell that much for every 1% it <em>rises</em>.
          </p>
          <ul>
            <li><strong>Net GEX (per expiration)</strong> shown on each row of the expirations table — useful for understanding which expiration carries the heavy positioning.</li>
            <li><strong>Total Net GEX</strong> shown below the table — the sum across all listed expirations. The single number that summarizes the ticker&apos;s gamma posture.</li>
          </ul>
          <p>
            <strong>Magnitudes worth knowing</strong> (rough order of magnitude — actual values
            vary by ticker and date):
          </p>
          <ul>
            <li>SPX/SPY Total GEX of <Code>+$5B</Code> per 1% = strongly positive-gamma → expect a quiet day.</li>
            <li>SPX/SPY Total GEX near zero or negative = expect range expansion.</li>
            <li>Single-stock GEX in the <Code>+$50M to +$500M</Code> range is meaningful for the name; below that, the gamma profile is mostly noise.</li>
          </ul>

          <H2 id="alerts">6. Alerts — types and severity</H2>
          <p>
            Each scan compares its readings to the prior scan and emits structured alerts when
            something materially changed. The alert banner at the top of the scan page shows
            counts by severity; per-ticker alerts appear in the &quot;Active alerts&quot; section
            of the detail pane.
          </p>

          <H3>Severity</H3>
          <ul>
            <li><strong>HIGH</strong> (rose dot) — actionable: a regime shift or wall break that should change how you trade the name today.</li>
            <li><strong>MED</strong> (amber dot) — worth knowing: significant level migration, but not necessarily trade-altering on its own.</li>
            <li><strong>LOW</strong> (gray dot) — informational: small moves in levels, source disagreements, etc.</li>
          </ul>

          <H3>Alert types</H3>
          <ul>
            <li>
              <strong><Code>GAMMA_FLIP_CROSS</Code></strong> — spot has crossed the zero-gamma
              flip strike since the last scan. Regime has changed. Re-evaluate everything.
            </li>
            <li>
              <strong><Code>REGIME_CHANGE</Code></strong> — the classified regime (POS/NEG/FLIP)
              flipped between scans. Often paired with a flip cross.
            </li>
            <li>
              <strong><Code>MAX_PAIN_SHIFT</Code></strong> — front-month Max Pain moved
              meaningfully (typically &gt; 1% of spot). Pin target relocated.
            </li>
            <li>
              <strong><Code>WALL_BREAK_CALL</Code></strong> — spot pushed through the prior call
              wall to the upside. Resistance failed; next resistance is the new wall.
            </li>
            <li>
              <strong><Code>WALL_BREAK_PUT</Code></strong> — spot broke through the prior put
              wall to the downside. Support failed; in negative-gamma regimes this often
              cascades.
            </li>
            <li>
              <strong><Code>FLIP_MIGRATION</Code></strong> — the zero-gamma flip strike itself
              moved (because positioning shifted, not because spot moved). The regime boundary
              relocated.
            </li>
            <li>
              <strong><Code>CROSS_SOURCE_DISAGREE</Code></strong> — independent data sources
              disagree on a level by more than tolerance. Treat the readings as uncertain until
              they reconcile.
            </li>
          </ul>

          <H2 id="expirations">7. The expirations table</H2>
          <p>
            Up to ten expirations sorted by DTE, with the front month highlighted. Columns:
          </p>
          <ul>
            <li><strong>Expiry</strong> — the expiration date.</li>
            <li><strong>DTE</strong> — calendar days to expiration. <Code>0</Code> = expires today.</li>
            <li><strong>Max Pain</strong> — the per-expiration Max Pain strike.</li>
            <li><strong>Spot Δ%</strong> — % distance from spot to that expiration&apos;s Max Pain.</li>
            <li><strong>Call OI / Put OI</strong> — total open interest on each side for that expiration.</li>
            <li><strong>P/C</strong> — put-to-call open-interest ratio. &gt; 1 = more puts open; &lt; 1 = more calls open.</li>
            <li><strong>Net GEX ($M)</strong> — dealer gamma exposure for that expiration in $M per 1% spot move. Green = positive (dampening), rose = negative (amplifying).</li>
          </ul>
          <p>
            <strong>How to use it.</strong> Front-month dominates pinning behavior on Fridays.
            Look for expirations with both high OI and large Net GEX magnitude — these are the
            ones whose hedging flow will move the underlying.
          </p>

          <H2 id="tags">8. Tags — RETAIL, PIN, EST, STALE</H2>
          <ul>
            <li>
              <strong>RETAIL</strong> (cyan) — the ticker has notable retail flow concentration.
              Translation: positioning may be sentiment-driven and less informative about
              institutional view. Pinning still applies, but expect more &quot;noise&quot; trades.
            </li>
            <li>
              <strong>PIN</strong> (violet) — the ticker is on the pin-friendly watch list. These
              are names with historical evidence of pinning into expirations.
            </li>
            <li>
              <strong>EST</strong> (amber) — one or more values are estimated rather than directly
              observed. Treat the levels as approximate.
            </li>
            <li>
              <strong>STALE</strong> (orange) — the underlying data is older than the freshness
              tolerance. The reading may not reflect current positioning.
            </li>
          </ul>

          <H2 id="workflow">9. Suggested 0DTE workflow</H2>
          <ol>
            <li>
              <strong>Open the latest scan.</strong> Scans publish each weekday at ~9:55 AM ET.
              Glance at the alert banner — any HIGH counts mean something material changed since
              yesterday.
            </li>
            <li>
              <strong>Start with index/vol.</strong> SPX/SPY/QQQ regime sets the tone for
              everything else. If SPX is deep POS, single-name vol will be suppressed; if NEG,
              expect range expansion across the board.
            </li>
            <li>
              <strong>Look at the four levels for your candidate trade.</strong> Where is spot
              relative to the flip? How far to Max Pain? Where are the walls?
            </li>
            <li>
              <strong>Match strategy to regime.</strong> Premium-selling structures in POS;
              directional buys in NEG; nothing aggressive in FLIP until spot commits.
            </li>
            <li>
              <strong>Use walls as profit targets and stops.</strong> A long-call working into a
              call wall: take profit at or before the wall. A bearish trade with the put wall as
              support: stop above the wall break, target below it.
            </li>
            <li>
              <strong>Read the per-ticker alerts.</strong> If a <Code>WALL_BREAK</Code> or
              <Code>GAMMA_FLIP_CROSS</Code> just printed, the prior playbook is invalid. Re-derive.
            </li>
            <li>
              <strong>Skip if any of:</strong> the ticker is STALE, the source is EST and your
              size is meaningful, regime is FLIP and you don&apos;t need to be in this name today,
              or the cross-source alert is HIGH on the levels you&apos;re trading off.
            </li>
          </ol>

          <H2 id="caveats">10. Honest caveats</H2>
          <ul>
            <li>
              <strong>Max Pain is descriptive, not predictive.</strong> It tells you where OI is
              concentrated, not where price &quot;should&quot; go. Pinning is one of several
              forces; news, earnings, and macro routinely override it.
            </li>
            <li>
              <strong>GEX models assume dealers hedge mechanically.</strong> Real dealer behavior
              involves discretion, basket hedging, vol surface management, and overnight risk
              limits. Treat GEX as a probabilistic tilt, not a deterministic trigger.
            </li>
            <li>
              <strong>The flip strike is sensitive to model assumptions.</strong> Different
              providers compute it differently; the <Code>CROSS_SOURCE_DISAGREE</Code> alert
              exists because the disagreement can be material.
            </li>
            <li>
              <strong>OI is end-of-day.</strong> Open interest updates after the close. Intraday
              positioning shifts (especially on 0DTE) are <em>not</em> in these numbers until the
              next morning&apos;s scan.
            </li>
            <li>
              <strong>Scans are once-daily.</strong> Levels can migrate during the session.
              Re-derive your read off live spot — don&apos;t treat the scan as a real-time feed.
            </li>
            <li>
              <strong>Single-stock GEX is noisier than index GEX.</strong> SPX/SPY have deep,
              broad option books; small-caps have concentrated positioning that a single
              institutional unwind can flip overnight.
            </li>
            <li>
              <strong>Regime ≠ direction.</strong> A POS regime says &quot;range-bound&quot;;
              that range can be 1% above current spot or 1% below it. Use other tools for
              direction.
            </li>
          </ul>
        </article>
      </div>
    </>
  );
}
