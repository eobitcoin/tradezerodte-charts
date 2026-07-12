---
name: finora-ai
description: >-
  Produce a Finora.AI-style Smart-Money-Concepts trade analysis report for a
  stock/ETF ticker — computed from LIVE Polygon price data, never guessed.
  Covers a general evaluation, a technical-indicator scorecard (MACD, Vortex,
  PSAR, DMI, Stochastic, Momentum, RSI, MFI, Fisher, ADX), critical SMC levels
  (swing high/low, equilibrium, support/resistance ladders, demand/supply
  clusters, fair-value-gap imbalances), long/short trade ideas with concrete
  entries/targets/stops, an aligned options idea, and a Finora expectation.
  Use this whenever the user asks for a "Finora" report, a trade analysis /
  technical read / setup / levels / support & resistance / directional bias on
  a specific ticker (e.g. "Finora TSLA", "what's the setup on NVDA", "give me
  levels and a plan for SPY", "analyze AAPL on the 1h"), even if they don't say
  "Finora". Multi-timeframe (daily trend+levels, hourly entries) by default.
---

# Finora.AI — Smart-Money trade analysis

The point of this skill is that **every number in the report is computed from
live market data**, not invented. A bundled script pulls Polygon bars on two
timeframes and returns a structured JSON picture; you narrate that JSON into
the fixed Finora format below. Do not hand-wave levels or indicator states —
run the script and read them off.

## Step 1 — Run the engine

The engine needs `POLYGON_API_KEY` in the environment (same key the app uses).
From the skill directory, run:

```bash
python scripts/finora_analyze.py <TICKER>
# defaults: --htf day (trend + levels), --ltf hour (indicators + entries)
# override on request, e.g.:  python scripts/finora_analyze.py NVDA --ltf 15min
```

It prints one JSON object. Parse it. Key fields:

- `price`, `bias` (`bullish`/`bearish`/`neutral`), `htf`, `ltf`
- `trend`: `{ trend, structure, ema20, ema50 }` (higher-timeframe)
- `price_action`: `{ today, week, today_chg, week_chg }`
- `indicators`: each of MACD / Vortex / PSAR / DMI / Stochastic / Momentum /
  RSI / MFI / Fisher → `{ verdict: bullish|bearish, detail }`; plus `ADX`
  → `{ verdict: strong|moderate|weak, value, detail }`
- `indicator_tally`: `{ bullish: [...], bearish: [...] }`
- `levels`: `{ swing_high, swing_low, equilibrium, resistance[], support[],
  clusters[{low,high,touches}], imbalances[{type: supply|demand, low, high}] }`

If the script errors (no key, bad ticker, no bars, or a **stale-data
refusal**), report the error plainly and stop — don't fabricate a report. The
engine hard-fails rather than emit stale numbers: it cross-checks the bar
series against Polygon's live snapshot (last trade) and refuses if they
disagree by >1.5% or if the last bar is >7 days old. `price` in the JSON is
the **snapshot last trade** — the authoritative live price — never a possibly
stale bar close. If `warnings` is non-empty, surface each warning verbatim in
the report header.

## Step 2 — Narrate the report

Use this EXACT structure and emoji headers. Fill it from the JSON; keep the
voice analytical and confident but never promissory. Prices come straight from
the data — do not round differently or invent levels that aren't in the arrays.

```
📡 Data as of: {data_as_of.last_ltf_bar date/time} · live last trade {price}
   [+ any entries from `warnings`, verbatim]

🔍 General Evaluation:
- Current price for {ticker} is {price}, sitting {above/below} the equilibrium
  of the most recent swing ({equilibrium}). [state where price sits in the
  swing_low → swing_high range: discount below EQ, premium above EQ]
- The overall trend is {trend.trend} on the {htf} timeframe ({trend.structure};
  EMA20 {ema20} vs EMA50 {ema50}).
- Indicators are {mixed/aligned}: {bullish list} lean bullish while {bearish
  list} lean bearish. ADX is {ADX.verdict} ({ADX.value}) → {trending / choppy}.
- Price action is {today} today and {week} this week.

📉 Technical Indicators:
- {each bullish indicator}: Bullish 🟢
- {each bearish indicator}: Bearish 🔴
- ADX is {weak/moderate/strong} ({value}), suggesting {range-bound / developing
  / trending} conditions.

📈 Critical Levels:
- Most recent swing high {swing_high}, swing low {swing_low} — the key liquidity
  zones (sweeps/manipulations likely at the extremes).
- Closest resistance above: {resistance ladder, comma-separated}
- Closest support below: {support ladder}
- Demand/supply clusters: {clusters as low–high (N touches)}
- Imbalances: {each supply imbalance = a supply zone price may reject from;
  each demand imbalance = a support zone price may bounce from}
- [1–2 sentences tying it together: which side price is nearer, which
  imbalance/cluster is the decision zone]

💡 Trade Ideas:
- [Bias-led: if bearish, favor shorts on rejection of the nearest supply
  (resistance/supply imbalance); if bullish, favor longs on reclaim/bounce from
  the nearest demand. Give the specific level from the arrays.]
- [First targets = the next 2–3 support levels (for shorts) or resistance
  levels (for longs), listed in order from the ladder.]
- [The opposite-side setup: what would need to happen (a sweep of swing_low /
  swing_high + reversal confirmation) and its targets.]
- Stops: just beyond the swing_high (shorts) / swing_low (longs).

✅ Example Scenario for Short Entry:
- [Concrete: rally into {nearest supply zone}, wait for LTF rejection (bearish
  engulfing / pin bar / lower-TF breakdown), enter short on confirmation. TP at
  {support ladder in order}. Stop just above {swing_high or the supply zone}.]

✅ Example Scenario for Long Entry:
- [Concrete: sweep/tap of {nearest demand or swing_low}, wait for bullish
  confirmation (pin bar / engulfing / divergence), enter long. Target
  {resistance ladder in order}. Stop just below {swing_low}.]

🌌 My Expectation (Finora AI):
- [Your synthesized lean from bias + where price sits vs equilibrium + the
  nearest decision zone. State the "if it holds above/below X, bias flips"
  condition explicitly, naming the level.]

🎯 Options Idea:
- [Translate the bias into ONE defined-risk debit spread, ~30–45 DTE, using
  round strikes anchored to the computed levels: bearish → a put debit spread
  (long strike near current price / short strike near the first support
  target); bullish → a call debit spread (long near price / short near the
  first resistance target). State the strikes, the directional thesis in one
  line, and that it can be modeled in Risk Graph. Keep it defined-risk given a
  squeeze/level play can go either way.]

📝 This is not investment advice, only an educational report. Always wait for
confirmation and use proper risk management!
```

## Narration guidance (why, so you can adapt)

- **Lead with the data, reason like a trader.** The indicator tally and the
  HTF trend give the bias; the levels give the map. The job is to connect them:
  a bearish bias near resistance → short-on-rejection is the A+ read; the long
  is the counter-trend "only after a liquidity sweep" idea. Mirror that logic
  for a bullish bias near support.
- **Premium vs discount matters.** Above equilibrium is "premium" (favor shorts
  in a bearish market); below is "discount" (favor longs in a bullish market).
  Say which side of equilibrium price is on.
- **Use imbalances as decision zones.** A `supply` FVG above price is where a
  bounce is likely to stall/reverse; a `demand` FVG below is where a drop is
  likely to find a bid. Name the specific zone the setup keys off.
- **Targets come from the ladders, in order** — don't skip around. Shorts walk
  down the support array; longs walk up the resistance array.
- **Neutral bias:** present both scenarios even-handedly and let the decision
  zones (equilibrium, nearest cluster) define the trigger; don't force a side.
- **Options idea stays defined-risk.** A level/expansion play can fail either
  way, so a debit spread (capped risk) is the honest expression, not a naked
  long option. Anchor strikes to the actual computed levels.

## Notes

- Timeframes: `--htf`/`--ltf` accept `15min`, `30min`, `hour`, `4hour`, `day`,
  `week`. Default `day` + `hour`. If the user names a timeframe ("on the 15m"),
  set `--ltf` to it; keep `--htf day` for the level map unless they ask.
- The engine is pure numpy/pandas/requests — no TA library, no app imports —
  so it runs standalone anywhere `POLYGON_API_KEY` is set.
- Crypto/forex are out of scope (Polygon stocks aggregates only); this is for
  US equities and ETFs.
