import type { Metadata } from "next";
import Link from "next/link";
import PublicHeader from "@/components/PublicHeader";
import PublicFooter from "@/components/PublicFooter";

const APP_URL = process.env.APP_URL || "https://www.tradezerodte.com";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "0DTE Trading Research — How to Read the Daily Post",
  description:
    "Long-form guide to the daily 0DTE Trading Research post: the trade summary table, A-to-F grades, entry zones / targets / stops, time-stop discipline, sentiment and bias chips, and the body analysis. Read this once and the daily report stops looking like jargon.",
  alternates: { canonical: `${APP_URL}/help` },
  openGraph: {
    type: "article",
    url: `${APP_URL}/help`,
    title: "0DTE Trading Research — How to Read the Daily Post",
    description:
      "Daily 0DTE research, decoded. Trade table columns, A-to-F grading, entry/exit discipline, sentiment chips, and the body analysis.",
  },
};

const ARTICLE_LD = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "0DTE Trading Research — How to Read the Daily Post",
  description:
    "Long-form guide to the daily 0DTE Trading Research post — trade table, grades, execution discipline, sentiment, body analysis.",
  url: `${APP_URL}/help`,
  publisher: {
    "@type": "Organization",
    name: "0DTE Market Research",
    url: APP_URL,
  },
};

function H2({ children, id }: { children: React.ReactNode; id: string }) {
  return (
    <h2
      id={id}
      className="text-lg font-semibold tracking-tight pt-6 mt-2 border-t border-white/10 first:border-t-0 first:pt-0 first:mt-0"
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
    <code className="px-1 py-0.5 rounded bg-white/[0.08] text-[0.9em] font-mono">
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

function GradePill({ grade, color }: { grade: string; color: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-semibold rounded border ${color}`}>
      {grade}
    </span>
  );
}

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col lining-nums">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ARTICLE_LD) }}
      />
      <PublicHeader />
      <div className="flex-1 max-w-5xl mx-auto px-4 py-8 space-y-6 w-full">
        {/* Breadcrumb */}
        <nav className="text-xs text-white/45">
          <Link href="/welcome" className="hover:text-white">Home</Link>
          <span className="mx-2">·</span>
          <Link href="/learn" className="hover:text-white">Learn</Link>
          <span className="mx-2">·</span>
          <span className="text-white/65">How to Read the Daily 0DTE Post</span>
        </nav>
        <header className="space-y-2">
          <h1 className="text-3xl lg:text-4xl font-bold tracking-tight leading-[1.15]">
            0DTE Trading Research — How to Read the Daily Post
          </h1>
          <p className="text-base text-white/65 max-w-prose">
            How to read the daily research post — the trade summary table, grades, entry/exit
            discipline, and the body analysis. Read this once and the daily report stops looking
            like jargon.
          </p>
        </header>

        {/* Table of contents */}
        <nav className="rounded-lg border border-white/10 px-4 py-3 text-sm max-w-3xl">
          <div className="text-xs uppercase tracking-wide text-white/55 mb-2">
            Contents
          </div>
          <ul className="space-y-1">
            <li><a className="hover:underline" href="#what-is-0dte">1. What 0DTE is and why this exists</a></li>
            <li><a className="hover:underline" href="#orientation">2. What you&apos;re looking at on the home page</a></li>
            <li><a className="hover:underline" href="#trade-table">3. The trade summary table — every column</a></li>
            <li><a className="hover:underline" href="#grades">4. Grades — what A through F actually mean</a></li>
            <li><a className="hover:underline" href="#direction">5. Direction — call / put / long / short / avoid</a></li>
            <li><a className="hover:underline" href="#execution">6. Entry zone, targets, stop, time stop</a></li>
            <li><a className="hover:underline" href="#sentiment">7. Sentiment and bias chips</a></li>
            <li><a className="hover:underline" href="#body">8. The body analysis — what to read for</a></li>
            <li><a className="hover:underline" href="#charts">9. Charts</a></li>
            <li><a className="hover:underline" href="#calendar">10. The calendar — historical posts</a></li>
            <li><a className="hover:underline" href="#workflow">11. Suggested pre-market workflow</a></li>
            <li><a className="hover:underline" href="#caveats">12. Honest caveats</a></li>
          </ul>
        </nav>

        <article className="prose prose-invert max-w-3xl">
          <H2 id="what-is-0dte">1. What 0DTE is and why this exists</H2>
          <p>
            <strong>0DTE</strong> = &quot;zero days to expiration&quot;: option contracts that
            expire the same day they are traded. SPX, SPY, QQQ, NDX, and a growing list of
            single-name tickers now offer daily-expiration option chains, making 0DTE a distinct
            trading style rather than a quirk reserved for monthly OPEX Fridays.
          </p>
          <p>What makes 0DTE different from regular options trading:</p>
          <ul>
            <li>
              <strong>Theta is brutal.</strong> A 0DTE option loses essentially all its time value
              in a single session. Holding through a flat market is a guaranteed loss.
            </li>
            <li>
              <strong>Gamma is enormous.</strong> Tiny moves in spot produce large changes in
              delta. Wins compound fast; so do losses. Position sizing matters more than direction
              calls.
            </li>
            <li>
              <strong>Dealer hedging dominates intraday tape.</strong> The mechanics described on
              the <Link className="underline" href="/learn/max-pain">Max Pain</Link> and{" "}
              <Link className="underline" href="/learn/gamma-exposure">Gamma Exposure</Link> primers{" "}
              — gamma flips, walls, regime — drive a meaningful share of the price action.
            </li>
            <li>
              <strong>Liquidity windows matter.</strong> Open and close are where 0DTE gets traded
              with depth; midday is often choppy on lighter flow.
            </li>
          </ul>
          <p>
            The daily research post on the home page is built specifically for this style: a
            handful of high-conviction trade plans with explicit entries, targets, and stops —
            generated each weekday morning before the open — plus the macro and microstructure
            context behind them.
          </p>

          <H2 id="orientation">2. What you&apos;re looking at on the home page</H2>
          <p>
            The home page (<Code>/</Code>) shows the most recent research post. Four sections
            stack top-to-bottom:
          </p>
          <ol>
            <li>
              <strong>Header</strong> — trading day, the time the analysis was generated (in ET),
              the post title, and (when present) sentiment and bias chips.
            </li>
            <li>
              <strong>Trade summary table</strong> — the day&apos;s candidate trades with grades
              and full execution parameters. Followed by a per-trade one-line rationale list.
            </li>
            <li>
              <strong>Body analysis</strong> — the markdown writeup behind the trades: macro
              context, key levels, microstructure notes, scenarios.
            </li>
            <li>
              <strong>Charts</strong> — supporting images (typically GEX profiles, option
              positioning, key chart levels).
            </li>
          </ol>
          <Note>
            If the latest post is from a previous trading day, an amber banner says so at the top.
            Posts are generated at the start of each weekday session — if you&apos;re looking
            before that day&apos;s post lands, you&apos;ll see yesterday&apos;s as a fallback.
          </Note>

          <H2 id="trade-table">3. The trade summary table — every column</H2>
          <p>The table is sorted by grade (A+ first, F last). Columns:</p>
          <ul>
            <li><strong>#</strong> — sort position. Not a priority signal on its own; the grade is.</li>
            <li><strong>Ticker</strong> — clickable, jumps to that ticker&apos;s deeper section in the body.</li>
            <li><strong>Grade</strong> — letter grade (A+ to F). See <a className="underline" href="#grades">section 4</a>.</li>
            <li><strong>Dir</strong> — direction pill: <Code>CALL</Code> / <Code>PUT</Code> / <Code>LONG</Code> / <Code>SHORT</Code> / <Code>AVOID</Code>. See <a className="underline" href="#direction">section 5</a>.</li>
            <li><strong>Strike</strong> — the option strike for the trade. May be a single number or a range.</li>
            <li><strong>Entry</strong> — entry zone (price range) or trigger condition. This is where to start engaging, not a market-on-open instruction.</li>
            <li><strong>T1 / T2</strong> — first and second profit targets. T1 is the &quot;take some off&quot; level; T2 is the stretch.</li>
            <li><strong>Stop</strong> — invalidation level. If the underlying or the option crosses it, the thesis is wrong.</li>
            <li><strong>Time stop</strong> — when to exit if neither target nor stop has been hit. 0DTE plans without a time stop are incomplete; theta will close them for you, badly.</li>
          </ul>
          <p>
            Below the table, a one-line rationale per trade summarizes the &quot;why&quot;. The
            full reasoning lives in the body section.
          </p>

          <H2 id="grades">4. Grades — what A through F actually mean</H2>
          <p>
            Every trade gets a letter grade reflecting overall conviction: setup quality, risk/reward,
            and how cleanly the supporting evidence aligns. Grades are not interchangeable across
            days — an &quot;A&quot; on a quiet day is different from an &quot;A&quot; before FOMC.
          </p>
          <ul>
            <li>
              <GradePill grade="A+ / A / A-" color="bg-emerald-500/15 text-emerald-300 border-emerald-500/40" />{" "}
              — the highest-conviction setups for the day. Multiple independent factors line up:
              technical level, dealer positioning, macro context, flow data, etc. These are the
              ideas worth meaningful size.
            </li>
            <li>
              <GradePill grade="B+ / B / B-" color="bg-sky-500/15 text-sky-300 border-sky-500/40" />{" "}
              — solid setups with one or two factors aligned but missing full confluence. Worth
              taking, but with smaller size or stricter trigger discipline.
            </li>
            <li>
              <GradePill grade="C+ / C / C-" color="bg-amber-500/15 text-amber-300 border-amber-500/40" />{" "}
              — speculative or requires a specific catalyst to fire. Often listed for awareness
              rather than as a primary plan. Consider only if your read on the catalyst is strong.
            </li>
            <li>
              <GradePill grade="D+ / D / D-" color="bg-orange-500/15 text-orange-300 border-orange-500/40" />{" "}
              — known-poor setups included for transparency (something looks tradable on the
              surface, but the analysis says don&apos;t). Skip unless you have your own edge.
            </li>
            <li>
              <GradePill grade="F" color="bg-red-500/15 text-red-300 border-red-500/40" />{" "}
              — explicit do-not-trade calls. The ticker often shows up because the chart looks
              tempting; the &quot;F&quot; is the warning to stay out.
            </li>
          </ul>
          <Note>
            On any given day, expect the table to mostly contain B and C grades, with one or two
            As, and the occasional D or F. A day full of A+s is suspicious — either a genuinely
            extraordinary setup or overconfidence. Be skeptical either way.
          </Note>

          <H2 id="direction">5. Direction — call / put / long / short / avoid</H2>
          <ul>
            <li>
              <strong>CALL</strong> (green pill) — bullish option play; buying calls or call
              spreads on the ticker. Profits if spot rises through the strike.
            </li>
            <li>
              <strong>PUT</strong> (rose pill) — bearish option play; buying puts or put spreads.
              Profits if spot falls through the strike.
            </li>
            <li>
              <strong>LONG</strong> (green pill) — directional long, but expressed as something
              other than a vanilla call (could be the underlying, a debit spread, a synthetic,
              etc. — the body explains the structure).
            </li>
            <li>
              <strong>SHORT</strong> (rose pill) — directional short, similar caveat. Could be
              underlying, put spread, ratio, etc.
            </li>
            <li>
              <strong>AVOID</strong> (gray pill) — explicitly do not trade this name today. Either
              the setup looks like a trap, the catalyst risk is too binary, or liquidity is
              insufficient.
            </li>
          </ul>

          <H2 id="execution">6. Entry zone, targets, stop, time stop</H2>
          <p>
            The execution columns turn a directional view into a tradable plan. Treat them as
            constraints, not suggestions.
          </p>

          <H3>Entry zone</H3>
          <p>
            The price range or trigger condition that says &quot;the setup is now live.&quot;
            Examples: <Code>SPX 5180–5185</Code> (a price band), or
            <Code>break and hold above 5190</Code> (a trigger condition). If the entry zone never
            hits, the trade simply doesn&apos;t happen. Chasing through the zone is one of the
            biggest 0DTE losers — paying up for the same setup that is now closer to invalidation.
          </p>

          <H3>Target 1 (T1)</H3>
          <p>
            The first profit-take level. The standard discipline is: scale out half the position
            at T1, move the stop on the remainder to break-even (at minimum), let the rest run
            toward T2. T1 is usually the most-likely-to-be-touched level in the plan.
          </p>

          <H3>Target 2 (T2)</H3>
          <p>
            The stretch target. T2 hits less often than T1 but is where the trade pays for the
            losers. If you only ever take T1 and skip T2, your average winner shrinks and the
            edge can disappear.
          </p>

          <H3>Stop</H3>
          <p>
            The invalidation level — where the thesis is wrong. Stops can be expressed as:
          </p>
          <ul>
            <li><strong>Underlying price</strong> (e.g., &quot;stop below 5170&quot;) — most common.</li>
            <li><strong>Option price</strong> (e.g., &quot;stop at 1.50&quot;) — used when the option pricing reveals the move first.</li>
            <li><strong>Structural condition</strong> (e.g., &quot;stop on close back below VWAP&quot;) — used when noise around a level makes a hard price stop too easy to fish.</li>
          </ul>
          <p>
            <strong>Honor the stop.</strong> &quot;The market shook me out and then went my way&quot;
            is a common 0DTE complaint. It is also common because stops exist for a reason — the
            sample of all stop-then-reverse trades looks like a pattern; the sample of
            ignored-stops includes the trades that erased the account.
          </p>

          <H3>Time stop</H3>
          <p>
            The clock-based exit. Examples: <Code>11:00 ET</Code>, <Code>2:30 ET if not at T1</Code>,
            <Code>final 30 minutes</Code>. Theta accelerates non-linearly into the close, so a
            0DTE position that hasn&apos;t moved meaningfully by the time stop is statistically
            more likely to bleed out than to suddenly work. Time stops are non-negotiable on
            same-day expiry.
          </p>

          <H2 id="sentiment">7. Sentiment and bias chips</H2>
          <p>
            When present, two chips appear under the post title:
          </p>
          <ul>
            <li>
              <strong>Sentiment</strong> — the overall directional read on the day:
              <Code>bullish</Code>, <Code>bearish</Code>, or <Code>neutral</Code>. Says whether
              the writeup leans toward calls, puts, or fade structures across the table.
            </li>
            <li>
              <strong>Bias</strong> — a short structural tag describing the expected style of the
              day. Examples: <Code>fade-rallies</Code>, <Code>buy-dips</Code>,
              <Code>chop</Code>, <Code>trend-continuation</Code>. Often the most useful single
              piece of information on the page.
            </li>
          </ul>

          <H2 id="body">8. The body analysis — what to read for</H2>
          <p>
            The markdown body below the table is where the work lives. Different posts emphasize
            different things, but most of them touch on:
          </p>
          <ul>
            <li><strong>Macro / overnight</strong> — what moved overnight, what data prints today, what the futures opening tape is saying.</li>
            <li><strong>Index regime</strong> — SPX/SPY/QQQ gamma posture, where the flip strike sits, what behavior to expect from the broad tape (see the <Link className="underline" href="/learn/max-pain">Max Pain primer</Link>).</li>
            <li><strong>Per-ticker setups</strong> — the analysis behind each row in the trade summary. Click a ticker in the summary table to jump to its section.</li>
            <li><strong>Scenarios</strong> — &quot;if SPX breaks 5190 with breadth, then ...&quot;-style branching plans. These are how to adapt when the day doesn&apos;t open exactly to script.</li>
            <li><strong>Risks</strong> — events that would invalidate the day&apos;s plan in bulk: data prints, Fed speakers, geopolitical news.</li>
          </ul>
          <p>
            <strong>How to use it.</strong> Read the body <em>before</em> the open. The trade
            table is a summary; the body is the reasoning. If you trade only off the table without
            reading the body, you will inevitably take a setup the body specifically warned
            against.
          </p>

          <H2 id="charts">9. Charts</H2>
          <p>
            Supporting images appear at the bottom of the post when present. Common chart types:
          </p>
          <ul>
            <li><strong>GEX profile</strong> — dealer gamma by strike for the underlying. Shows the call/put walls and the flip strike at a glance.</li>
            <li><strong>Option positioning heat-map</strong> — open interest concentration by strike and expiry.</li>
            <li><strong>Key levels chart</strong> — the underlying with the day&apos;s referenced support/resistance lines drawn.</li>
          </ul>
          <p>Charts are reference material, not standalone trade signals — read them with the body context.</p>

          <H2 id="calendar">10. The calendar — historical posts</H2>
          <p>
            The Calendar link in the authenticated nav opens a month-grid view.
            Each cell is a trading day; days with a post show the top three tickers
            as chips. Click any cell to open that day&apos;s full post at{" "}
            <Code>/posts/&lt;date&gt;</Code>. Members only.
          </p>
          <p>
            <strong>Why this matters.</strong> Reviewing closed days is the single highest-leverage
            thing a 0DTE trader can do. Pull up a day from a week ago, look at what graded A vs F,
            then pull up a chart of how the day actually played out. Pattern recognition lives
            here.
          </p>

          <H2 id="workflow">11. Suggested pre-market workflow</H2>
          <ol>
            <li>
              <strong>Open the home page after 8:30 AM ET.</strong> Confirm today&apos;s post has
              landed (if not, wait — the no-banner empty state is intentional).
            </li>
            <li>
              <strong>Read the title and the sentiment / bias chips.</strong> One sentence sets the
              frame for the day.
            </li>
            <li>
              <strong>Scan the trade summary table.</strong> Note the A-grade names and any
              AVOID/F entries. Don&apos;t plan trades yet.
            </li>
            <li>
              <strong>Read the body in full.</strong> The reasoning behind each grade is in there.
              A trade table without its body is a list of strangers.
            </li>
            <li>
              <strong>Cross-reference with Max Pain.</strong>
              The max-pain scan (members-only) publishes around 9:55 AM ET — when it&apos;s up,
              check the regime and walls for any tickers you&apos;re planning to trade. See the{" "}
              <Link className="underline" href="/learn/max-pain">Max Pain primer</Link> for the
              underlying mechanics.
            </li>
            <li>
              <strong>Pick at most one or two trades.</strong> 0DTE size discipline matters more
              than coverage. Two A-grade ideas executed cleanly beat five trades scattered across
              the grade range.
            </li>
            <li>
              <strong>Pre-set entry alerts and stops.</strong> Use the entry zone to alert, not
              market-buy at the open. Pre-write the stop into your platform so the discipline is
              automatic.
            </li>
            <li>
              <strong>Time-box midday.</strong> If you&apos;re not in a trade by ~11:00 ET that hit
              its entry, the day&apos;s opportunity may have already played out. Don&apos;t force
              one.
            </li>
            <li>
              <strong>Review at the close.</strong> For each trade plan, write one line: &quot;hit
              entry / didn&apos;t&quot;, &quot;hit T1 / T2 / stop&quot;, &quot;was the grade
              right in hindsight&quot;. The calendar makes this fast.
            </li>
          </ol>

          <H2 id="caveats">12. Honest caveats</H2>
          <ul>
            <li>
              <strong>The grades are inputs, not edicts.</strong> An A-grade trade can still lose;
              an F can still print. The grade describes the <em>setup quality</em>, not the
              outcome. Over a large enough sample, A&apos;s win more than F&apos;s — but on any
              single day, anything can happen.
            </li>
            <li>
              <strong>0DTE size kills accounts faster than direction does.</strong> The single
              largest determinant of multi-month 0DTE survival is sizing each trade so a full
              stop costs less than 1–2% of your trading capital. The plans here assume
              you&apos;ve already solved that on your end.
            </li>
            <li>
              <strong>Same-day expiry rewards discipline, not improvisation.</strong> If the trade
              doesn&apos;t hit the entry zone, skip it. The setup tomorrow will be similarly
              graded; the same trade chased five points worse is now a different (worse) setup.
            </li>
            <li>
              <strong>Macro events override everything.</strong> A surprise FOMC headline, a CPI
              print outside expectations, or a credible geopolitical shock invalidates the plan
              instantly. The body usually flags scheduled risk events; surprise events are by
              definition unflagged.
            </li>
            <li>
              <strong>Liquidity-thin tickers are landmines.</strong> Just because a single-name
              ticker offers daily expirations doesn&apos;t mean it has tradable depth at every
              strike. Check option open interest and bid/ask before sizing — the plan assumes
              executable prices.
            </li>
            <li>
              <strong>Survivorship and recency bias are real.</strong> The plan you read today
              was generated against current conditions; conditions change. A bias that worked
              for two weeks can flip in a session.
            </li>
            <li>
              <strong>Past calendar performance is not future performance.</strong> The grade
              distribution and hit-rate visible in the calendar represent <em>this</em>{" "}
              market regime. Treat them as descriptive of recent history, not predictive of
              what comes next.
            </li>
          </ul>
        </article>

        {/* CTA */}
        <aside className="mt-12 rounded-lg border border-red-500/40 bg-gradient-to-br from-red-500/[0.08] to-transparent p-6 space-y-3 max-w-3xl">
          <h2 className="text-xl font-bold tracking-tight">
            See the daily research applied to today&apos;s tape.
          </h2>
          <p className="text-sm text-white/65 max-w-prose">
            0DTE Market Research is invite-only. The daily brief ships before
            the open with grades, entries, targets, stops, and the rationale on
            each setup.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link
              href="/welcome#waitlist"
              className="inline-block px-5 py-3 rounded-md bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold uppercase tracking-[0.22em] shadow-lg shadow-red-900/30 transition-colors"
            >
              Request an Invitation
            </Link>
            <Link
              href="/explore"
              className="text-xs text-white/65 hover:text-white hover:underline"
            >
              See public previews →
            </Link>
          </div>
        </aside>

        {/* Related learn pages */}
        <section className="mt-12 pt-8 border-t border-white/10 max-w-3xl">
          <h2 className="text-sm font-bold tracking-tight uppercase text-white/55 mb-4">
            Keep reading
          </h2>
          <ul className="grid sm:grid-cols-2 gap-3">
            {[
              { href: "/learn/0dte-options", title: "What is 0DTE Options Trading?" },
              { href: "/learn/trade-cards", title: "Reading the Trade Cards" },
              { href: "/learn/analysis", title: "Reading the Analysis Tab" },
              { href: "/learn/scorecard", title: "Scorecard — Performance Over Time" },
              { href: "/learn/max-pain", title: "Max Pain" },
              { href: "/learn/gamma-exposure", title: "Gamma Exposure (GEX)" },
            ].map((it) => (
              <li key={it.href}>
                <Link
                  href={it.href}
                  className="block rounded-md border border-white/10 hover:border-red-500/40 hover:bg-white/[0.03] p-3 transition-all"
                >
                  <div className="text-sm font-semibold">{it.title} →</div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <PublicFooter />
    </div>
  );
}
