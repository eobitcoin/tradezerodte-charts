# BotWick — Architecture & Build Plan

**Status:** UI scaffolding shipped (this PR). Runner, risk engine, OMS, and Tradier integration are designed below and built in phases.

**Owner safety stance:** money trading bots fail in ways that aren't fixable after the fact. Every section below has a paper-first, gradual-rollout default. Live mode is gated behind explicit admin flips and per-trade dollar caps, not just trust in the model.

---

## 1. What's live today

| Component | State |
|-----------|-------|
| Nav link → `/botwick` | ✅ Shipped (next to Polymarket) |
| `/botwick` page with USER + ADMIN tabs | ✅ Server-rendered, admin-only Admin tab |
| Matrix-themed user view (status, active positions, live tape) | ✅ Reads `bot_config` + `bot_actions` + `bot_trades` |
| Admin controls (enabled, mode, grade filter, risk caps, kill switch) | ✅ Persisted via `/api/admin/botwick/{config,kill}` |
| DB: `bot_config`, `bot_actions`, `bot_trades` | ✅ Drizzle schema + migration applied |
| Audit log | ✅ Every config change writes to `bot_actions` |
| **Runner that places real Tradier orders** | ❌ Not yet — see §3 for plan |

The schema and UI are deliberately a step ahead of the runner. The bot stays at `enabled=false, mode=off` until every piece below ships.

---

## 2. System boundaries

```
┌──────────────────────────────────────────────────────────────────┐
│ tradezerodte.com (Next.js — this repo)                           │
│                                                                  │
│  ┌────────────────┐   ┌──────────────────┐   ┌────────────────┐  │
│  │ /botwick UI    │   │ Admin API        │   │ Existing 0DTE  │  │
│  │ (Matrix view + │◄─►│ /api/admin/      │   │ research posts │  │
│  │  Admin tab)    │   │   botwick/...    │   │ (posts table)  │  │
│  └────────────────┘   └──────────────────┘   └────────┬───────┘  │
│         ▲                      ▲                      │          │
│         │ reads                │ mutates              │ reads    │
│         │                      │                      ▼          │
│  ┌──────┴──────────────────────┴──────────────────────┴───────┐  │
│  │ Postgres: bot_config · bot_actions · bot_trades · posts   │  │
│  └──────────────────────────┬─────────────────────────────────┘  │
└─────────────────────────────┼────────────────────────────────────┘
                              │ pgnotify / poll
                              ▼
            ┌─────────────────────────────────────┐
            │  BotWick Runner (separate process,  │
            │  Railway service)                   │
            │                                     │
            │  ┌──────┐ ┌──────┐ ┌──────────────┐ │
            │  │Plan  │ │Risk  │ │OMS (Tradier) │ │
            │  │ Loader│→│Engine│→│  REST + WS   │ │
            │  └──────┘ └──────┘ └──────┬───────┘ │
            │      ▲           ▲       │         │
            │      │           │       ▼         │
            │  ┌───┴───┐   ┌───┴──────────────┐  │
            │  │Trigger│   │ Tradier sandbox  │  │
            │  │engine │   │   or production  │  │
            │  └───────┘   └──────────────────┘  │
            └─────────────────────────────────────┘
```

**Why a separate runner process?**

1. Next.js server functions are request-scoped — you can't run a 9:30 AM → 4:00 PM market loop inside them.
2. Crash isolation: a runner OOM doesn't take the website down.
3. Independent deploy cadence: we can ship UI changes without touching trading code.
4. Easier to put a single mutex around order placement (one runner = no double-placements).

The runner ships as a separate Railway service in the same project, reading the same Postgres.

---

## 3. Phased rollout

| Phase | Scope | Live money? | Gate |
|-------|-------|-------------|------|
| **0 — Now** | UI + schema + audit | No | Already shipped |
| **1 — Plan ingest** | Runner subscribes to new `posts` rows, normalises plans into `bot_trades(status=pending)`, applies grade filter, never submits orders | No | Mode=paper, all submits stubbed |
| **2 — Paper trading** | Real Tradier sandbox orders, real fills, paper PnL accounting | No (sandbox) | Mode=paper, kill switch armed |
| **3 — Backtest harness** | Replay historical posts against historical option chains; calibrate slippage + fill assumptions | No | Offline only |
| **4 — Tiny-notional live** | $25/trade cap, 1 open at a time, 1 ticker (SPY only), full week | Yes (small) | Mode=live, admin manual flip per day |
| **5 — Scaled live** | Lift per-trade cap to admin-set value, multi-position, multi-ticker | Yes | Mode=live, automated arm at 9:30 ET if all preflights green |
| **6 — AI overlays** | Trade-quality scoring, regime filter, adaptive sizing | Yes | Layered as opt-in modifiers on top of base strategy |

Each phase requires the previous to run **two weeks without a Sev-1 incident**. No skipping.

---

## 4. Data model (already shipped)

### `bot_config` (singleton, id = "default")

| Column | Type | Notes |
|--------|------|-------|
| `enabled` | bool | Master switch. Default `false`. |
| `mode` | text | `off` \| `paper` \| `live` |
| `grade_filter` | text | `A+`, `A`, `A-`, `B+`, or `ALL` |
| `max_risk_per_trade_usd` | numeric | Premium debit or max-loss for spreads |
| `max_daily_loss_usd` | numeric | Hits trip the kill switch |
| `max_open_positions` | int | Concurrency cap |
| `kill_switch_engaged` | bool | Manual override, flat-closes everything |
| `kill_switch_reason` | text | Audit trail |
| `tradier_account_id` | text | UI hint; actual secret in env |
| `tradier_env` | text | `sandbox` \| `production` |
| `prefs` | jsonb | Free-form for risk-engine knobs |
| `updated_at`, `updated_by` | meta | Who changed what, when |

### `bot_actions` (append-only audit + Matrix tape)

| Column | Type | Notes |
|--------|------|-------|
| `ts` | timestamptz | Indexed desc — tape ordering |
| `kind` | text | `config_change`, `plan_received`, `signal_fired`, `order_submitted`, `order_filled`, `risk_block`, `kill_switch`, … |
| `severity` | text | `info` \| `success` \| `warn` \| `error` (color in UI) |
| `message` | text | Human line |
| `trade_id` | uuid | Optional FK → `bot_trades.id` |
| `data` | jsonb | Structured payload |

### `bot_trades` (one row per intent, full lifecycle)

| Column | Notes |
|--------|-------|
| `source_post_day`, `source_ticker`, `source_grade` | Provenance — which research post this came from |
| `strategy` | `long_put`, `credit_call_spread`, … |
| `tradier_order_id`, `tradier_position_id` | Linkage |
| `legs` jsonb | Multi-leg representation (side, symbol, strike, expiry, qty, fill_price) |
| `plan` jsonb | Snapshot of entry/exits/triggers at signal time |
| `mode` | `paper` \| `live` |
| `status` | `pending` → `working` → `open` → `closing` → `closed` (or `rejected`/`cancelled`/`errored`) |
| `entry_fill_usd`, `exit_fill_usd`, `realized_pnl_usd` | Money |
| `signaled_at`, `submitted_at`, `filled_at`, `closed_at` | Lifecycle stamps |

---

## 5. Plan ingestion

The 0DTE research post body (markdown) already contains structured trade plans — they're parsed into the `posts.trades` jsonb on write, and we render them in the Trade Summary table.

**Plan loader algorithm:**

```python
on new posts row inserted (trigger or 10s poll on posts.tradingDay = today):
    cfg = read bot_config
    if not cfg.enabled or cfg.mode == "off": return

    for trade in post.trades:
        if trade.grade not in allowed_grades(cfg.grade_filter):
            log bot_actions(plan_skipped, "grade {trade.grade} below filter {cfg.grade_filter}")
            continue

        # Normalize the trade plan: ticker, strike, direction, entry_trigger,
        # target1, target2, stop, time_stop. Parse natural-language entries
        # ("First 5-min candle close below $438 with VWAP rejection") into
        # structured triggers (see §6).

        botTrade = insert bot_trades(
            status = "pending",
            sourcePostDay = post.trading_day,
            sourceTicker = trade.ticker,
            sourceGrade = trade.grade,
            strategy = infer_strategy(trade),       # long_put for the example
            legs = build_legs(trade),               # one TSLA 437.5P 0DTE leg
            plan = trade,
            mode = cfg.mode,
        )
        log bot_actions(plan_received, ...)
```

`allowed_grades("A+")` = `["A+"]`. `allowed_grades("A-")` = `["A+", "A", "A-"]`. Strict subset semantics.

---

## 6. Trigger engine

Plans encode entry conditions in natural language. We support a constrained DSL by parsing on the way in, then evaluating on a tick stream.

**Supported predicates** (extensible):

| Predicate | Example phrase | Evaluation |
|-----------|----------------|-----------|
| `bar_close_below(price, tf="5min")` | "5-min candle close below $438" | After each 5-min bar close |
| `bar_close_above(price, tf="5min")` | "close above $441.50" | Same |
| `vwap_rejection(side)` | "VWAP rejection" | Bar high tagged session VWAP, then closed lower (for shorts) |
| `time_after(et)` | "after 09:45 ET" | Wall clock |
| `time_before(et)` | "by 12:30 ET" | Wall clock |
| `underlying_at(price, op)` | "underlying back above 441.50" | Last trade tick |

**Trigger AST per trade:**

```json
{
  "entry": {
    "all": [
      {"bar_close_below": {"price": 438, "tf": "5min"}},
      {"vwap_rejection": {"side": "short"}}
    ]
  },
  "target1": {"any": [
    {"underlying_at": {"price": 432, "op": "<="}},
    {"premium_pct_gte": 60}
  ]},
  "target2": {"any": [
    {"underlying_at": {"price": 428, "op": "<="}},
    {"premium_pct_gte": 120}
  ]},
  "stop": {"any": [
    {"underlying_at": {"price": 441.50, "op": ">="}},
    {"premium_pct_lte": -40}
  ]},
  "time_stop": {"time_after": "12:30 ET"}
}
```

**Evaluator loop** (pseudocode):

```python
async def run_trade(trade):
    triggers = parse(trade.plan)
    leg = trade.legs[0]
    ticker = leg.underlying

    # Subscribe to Tradier WebSocket streams.
    bars5 = subscribe_bars(ticker, "5min")
    quotes = subscribe_quote(ticker)
    opt_quote = subscribe_quote(leg.option_symbol)

    async for tick in merge(bars5, quotes, opt_quote):
        if eval(triggers.entry, tick):
            mid = (opt_quote.bid + opt_quote.ask) / 2
            ok, reason = risk_engine.check(trade, mid)
            if not ok:
                log bot_actions(risk_block, reason); trade.status = "rejected"; return
            await oms.submit_open(trade, limit=mid)
            trade.status = "working"
            break

    # Then track exits...
```

---

## 6.5. Plan estimate vs live quote — the pricing rule

**Two prices, two purposes. Don't confuse them.**

| Number | Where it comes from | What it's used for |
|--------|---------------------|--------------------|
| **Plan estimate** (`plan.entryMidEstimate`) | Pre-market research post prose — `entry_zone` field, parsed at ingest time. Example: `"$4.50 – $5.50"` → `5.00`. | **Pre-filter only.** Drops obviously-too-expensive plans before market open. Used by the ingest-time risk check to decide "could this plausibly fit my $/trade cap?" |
| **Live mid** (computed at signal-fire time) | Tradier quote endpoint: `(bid + ask) / 2`. | **Every real decision.** Sizing engine picks contract count off this. Risk engine re-evaluates the per-trade cap against this. Limit order price is set at this. Slippage is measured from this. |

### Why the split exists

The pre-market plan is written hours before the open. By 9:30 ET, IV has re-priced, the underlying may have gapped, and the option chain looks different. Using the plan estimate to size or price a real order would be sizing yesterday's market. We capture the plan estimate at ingest so we can:

1. **Pre-filter cheaply** (don't even put a $3000 plan in the queue if your per-trade cap is $250).
2. **Audit drift** — after the trade closes, compare plan estimate to actual fill to measure "plan slippage" as a fleet statistic over weeks.

### What the runner MUST do at signal-fire time (Phase 3+)

1. Trigger evaluator says entry condition met → transition to `signal_armed` (not `signal_fired` yet).
2. **Pull a fresh quote** from Tradier for the option contract. Compute `live_mid = (bid + ask) / 2`.
3. **Re-run the risk engine** with `live_mid` (not the plan estimate). Every gate that compared against price now uses the live number.
4. **Plan-slippage guard** (new config knob): if `abs(live_mid - entryMidEstimate) / entryMidEstimate > maxPlanSlippagePct` (default 50%), block with `risk_block: live mid $12.00 deviates 140% from plan $5.00`. The plan's premise may no longer hold; skip rather than overpay or trade blindly.
5. **Spread/liquidity sanity** (also live-quote driven): `(ask - bid) / live_mid` must be ≤ `maxRelativeSpread` (default 10%). Volume/open-interest minimums apply here too.
6. **Sizing engine**: `contracts = floor(maxRiskPerTradeUsd / (live_mid * 100))`. If 0, log `risk_block: cap won't cover one contract at live mid`.
7. **All checks pass** → transition to `signal_fired`, submit limit order to Tradier at `live_mid` (or `live_mid - $0.01` for buys), re-peg every 5s for 30s, then cross.

### Auditability

To make the drift visible, persist both numbers on `bot_trades`:

- `plan.entryMidEstimate` — already captured at ingest (jsonb on `bot_trades.plan`).
- `bot_trades.entryFillUsd` — already in the schema, populated by the OMS at fill.
- New event kind in `bot_actions`: `quote_refresh` — emitted each time the runner pulls a live quote for a pending trade. Payload: `{ ticker, optionSymbol, bid, ask, mid, planEstimate, deviation_pct }`. Lets the Matrix tape show "we considered this trade, here's what we saw."

### The new statuses (Phase 3a shipped, 3b promotes)

Both states are live in the schema as of Phase 3a's migration; the semantics are now concrete:

- **`signal_armed`** — entry condition matched on underlying market data. The trade is latched here even if the live re-check fails — entry triggers don't un-fire when the underlying moves back. A failed re-check keeps the row in `signal_armed`, and each subsequent monitor tick retries the re-check (pulls a fresh option quote, runs the slippage guard + live-mid cap). Stays here until either re-check passes (→ `signal_fired`) or the trade's time_stop closes it out.
- **`signal_fired`** — armed AND passed the live re-check: option quote available, plan-slippage within `maxPlanSlippagePct`, one-contract risk at live mid ≤ `maxRiskPerTradeUsd`. Next stop: OMS submission → `working`.

The pipeline:
```
pending ──entry matches──► signal_armed ──live re-check passes──► signal_fired ──OMS──► working
                              ▲                                      
                              └── re-check fails, retry next tick ──┘
```

Phase 3b implemented `pending → signal_armed → signal_fired`. Phase 4 (the OMS) is what turns `signal_fired → working`.

### Why we're writing this down now, not coding it

We're between Phase 1 (ingest, shipped) and Phase 3 (Tradier client + runner). The natural temptation when wiring the runner will be to reach for `plan.entryMidEstimate` because it's already on the row. This section is the explicit instruction to **not do that** — even though it would compile and pass tests, it would be the kind of subtle wrong that produces a strange Friday afternoon.

### Data routing vs order routing

`mode=paper` is split. **Data** calls (quotes / bars / option mids) prefer the production feed when a `TRADIER_LIVE_TOKEN` or `TRADIER_API_KEY` is configured — falling back to sandbox (15-min delayed) only when no live token exists. **Order** calls always go to sandbox for paper, regardless of data routing. So paper trading gets real-time price feedback without risking real money.

The adapter exposes this split as two helpers:
- `dataEnvFromMode(mode)` — used by `getQuotes`, `getOptionQuote`, `getTimesales`.
- `orderEnvFromMode(mode)` — used by `submitOrder`, `getOrderStatus`.

No admin config knob — the presence of env vars encodes intent. `getCredsStatus().paperDataSource` returns `"live_realtime"` or `"sandbox_delayed"` and the admin UI surfaces it so there's never ambiguity about which feed paper mode is using.

### Sister rail: `live_orders_confirmed`

A boolean column on `bot_config` introduced alongside Phase 3a. The OMS (Phase 4+) **MUST** check all four of these before submitting a live order:

```
enabled === true
mode === "live"
kill_switch_engaged === false
live_orders_confirmed === true
```

Why a separate flag instead of just "mode === live"? Because Phase 3a/3b deliberately let admins run `mode=live` against production market data for real-time monitoring while the OMS doesn't yet exist. When the OMS DOES exist, the day we deploy it must not silently arm real trading on accounts where mode=live was set for monitoring reasons.

Properties:
- **Defaults false.** Fresh installs cannot trade live without explicit consent.
- **Resets on kill switch.** Engaging the kill switch sets `live_orders_confirmed = false` automatically — after any incident, the admin must explicitly re-confirm before live trading resumes.
- **Audit trail.** Toggling it writes a `config_change` row to `bot_actions` like every other config mutation.
- **UI copy is non-bureaucratic.** The admin must read what they're confirming, not click through a generic "are you sure?" modal.

---

## 7. Risk engine

**Non-negotiable**: the risk engine sits between every order intent and the OMS. No path bypasses it.

```python
def check(trade, mid_price) -> (ok: bool, reason: str):
    cfg = read bot_config

    # Hard gates — fail fast.
    if cfg.kill_switch_engaged: return False, "kill switch"
    if not cfg.enabled:         return False, "bot disabled"

    # Per-trade dollar risk.
    risk = max_loss_for(trade, mid_price)   # premium for naked; max-loss for spreads
    if risk > Number(cfg.max_risk_per_trade_usd):
        return False, f"risk ${risk} > cap ${cfg.max_risk_per_trade_usd}"

    # Daily PnL drawdown.
    today_pnl = sum_realized_pnl_today() + sum_unrealized_pnl()
    if today_pnl <= -Number(cfg.max_daily_loss_usd):
        engage_kill_switch("daily loss cap hit")
        return False, "daily loss cap"

    # Concurrency.
    open_count = count_trades_in(["working", "open", "closing"])
    if open_count >= cfg.max_open_positions:
        return False, "max open positions"

    # Liquidity & spread sanity.
    if (ask - bid) / mid > 0.10:   # 10% spread
        return False, "spread too wide"
    if open_interest < 100 or volume_today < 50:
        return False, "thin contract"

    # Earnings / news blackouts.
    if has_earnings_today(trade.ticker):
        return False, "earnings blackout"

    # Buying power.
    if required_bp(trade) > tradier_account.buying_power * 0.5:
        return False, "BP > 50% cap"

    return True, "ok"
```

**Layered defaults (defense in depth):**

1. Per-trade cap → can't blow up on one fat-finger plan.
2. Per-day cap → bad market day can't compound.
3. Kill switch → manual emergency stop.
4. Mode gate → live requires explicit `enabled=true AND mode=live` (enforced in API route).
5. Tradier-side: Tradier has its own buying power limits; we're additive.

---

## 8. Order Management System

**Status as of Phase 5**: entry orders + exit orders + polling reconcile shipped. Smart re-pegging and sizing engine are Phase 4b polish.

### Exit lifecycle (Phase 5)

For each trade in `status='open'`, on every tick:

1. Pull the option's live quote (`getOptionQuote(mode, occSymbol)`) and compute `currentMid`.
2. Construct a per-trade `MarketState` from the ticker's underlying state (built once upstream) plus `entryFill = trade.entryFillUsd` and `currentMid`.
3. Evaluate the four exit branches in priority order:
   - `stop` → if matched, exit reason = `stop`. Highest priority.
   - `target1` OR `target2` → exit reason = `target`.
   - `time_stop` → exit reason = `time_stop`. Latest.
4. On match: submit `sell_to_close` at the live mid → race-safe transition `open → closing` → emit `exit_target_hit` / `exit_stop_hit` / `exit_time_stop` event.
5. Reconcile picks up the close fill on a subsequent tick:
   - **Filled** → status `closing → closed`, write `exitFillUsd`, `realizedPnlUsd = (exitFill - entryFill) × 100 × qty`, stamp `closedAt`, emit `order_filled` event with PnL in the message.
   - **Rejected/cancelled/expired** → status bounced back to `open` (the close failed; the position is still on), clear `tradierOrderId`, log a warning. Next tick re-evaluates exits and retries.

PnL math is intentionally per-leg long: `(exit - entry) × 100 × qty`. Spreads (when we get there) compute net debit/credit instead.

State machine:

```
        ┌──────────────────────────────────────────────────────┐
        │                                                      │
   pending ──submit──► working ──fill──► open ──exit_sig──► closing ──fill──► closed
        │              │                  │                       │
        │              └──reject───►rejected                       └──fill_fail──►errored
        │              └──timeout──►cancelled
        └──risk_block──►rejected
```

**Tradier integration sketch** (using their REST API + account event WS):

```ts
class TradierOMS {
  async submitOpen(trade: BotTrade, limit: number) {
    // Single-leg example. Multi-leg uses /orders with class="multileg".
    const res = await fetch(`${baseUrl}/v1/accounts/${accountId}/orders`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: new URLSearchParams({
        class: "option",
        symbol: trade.legs[0].underlying,
        option_symbol: trade.legs[0].option_symbol,
        side: trade.legs[0].side,        // buy_to_open | sell_to_open
        quantity: String(trade.legs[0].qty),
        type: "limit",
        duration: "day",
        price: limit.toFixed(2),
      }),
    });
    const body = await res.json();
    if (body.errors) throw new OmsError(body.errors);

    await db.update(botTrades)
      .set({
        tradierOrderId: body.order.id,
        status: "working",
        submittedAt: new Date(),
      })
      .where(eq(botTrades.id, trade.id));

    await log("order_submitted", `submit ${trade.sourceTicker} ${trade.strategy} @ ${limit}`);
  }
}
```

**Tradier account-event WebSocket** delivers `order` events. The OMS subscribes once at startup and reconciles fills:

```ts
ws.on("order", async (evt) => {
  const trade = await findTradeByTradierOrderId(evt.id);
  if (!trade) return;
  switch (evt.status) {
    case "filled":
      await mark(trade, { status: "open", filledAt: now(), entryFillUsd: evt.avg_fill_price });
      await log("order_filled", `fill ${evt.avg_fill_price}`);
      break;
    case "partially_filled":
      await log("order_partial", `partial @ ${evt.last_fill_price}`);
      break;
    case "rejected":
      await mark(trade, { status: "rejected" });
      await log("order_rejected", evt.reason, "error");
      break;
    // …cancelled, expired
  }
});
```

**Smart limit pricing** for entries: `mid - 0.01` (penny inside the mid) for buys, then re-peg every 5 seconds for 30 seconds, then cross the spread. Avoids paying the offer when the market would have filled you mid.

---

## 9. Streaming data

Two streams from Tradier:

1. **Quotes / option chain** — `/v1/markets/events/session` HTTP session token, then WebSocket. Subscribe per-symbol; volume is fine since we trade ≤ 3 tickers per day.
2. **Account events** — separate WS endpoint for fills.

Local aggregations the runner maintains:

- 5-min bars per ticker (close, high, low, volume) → used by `bar_close_*` predicates.
- Session VWAP per ticker → used by `vwap_rejection`.
- Per-trade mark-to-market via the option's bid/ask → used for `premium_pct_gte/lte` exits.

All in-memory; no persistence needed beyond the trade snapshots in `bot_trades.plan`.

---

## 10. Backtesting

Same trigger evaluator, different data source.

```
Historical posts (posts.trades for the trading_day) →
Historical option chains (Tradier `/markets/history` or third-party like ORATS) →
Replay 5-min bars + option marks →
Evaluator fires "synthetic" fills using assumed slippage (mid + 1c for buys, mid - 1c for sells) →
Append a row to `backtest_runs` table (future) with PnL, drawdown, hit rate, Sharpe, Sortino
```

The trigger engine and risk engine code is shared between live and backtest — only the data source differs. This is the whole reason for the predicate DSL in §6.

---

## 11. AI overlays (Phase 6)

Layered modifiers, never primary deciders:

| Overlay | Effect |
|---------|--------|
| **Trade quality score** | LLM reads the plan + recent post + VIX/regime → outputs 0–100. If < 50, risk_engine downgrades the dollar cap by half. |
| **Regime detector** | Hidden-Markov on SPY 5-min bars → trending / chop / shock. Suppresses mean-reversion strategies in trending; suppresses breakouts in chop. |
| **Adaptive sizing** | Kelly fraction × score × volatility regime. Hard-capped by `max_risk_per_trade_usd`. |
| **Trade journal summarisation** | Daily LLM digest of the day's `bot_actions` tape → email + dashboard. |

Each overlay has a config flag in `bot_config.prefs.ai.*` and can be flipped independently. None of them can override the hard risk caps in §7.

---

## 12. Worked example — the TSLA put plan

```
Plan:    TSLA $437.5P 0DTE, Grade B+
Entry:   5-min close < $438 AND VWAP rejection
T1:      $432 underlying OR +60% premium
T2:      $428 underlying OR +120% premium
Stop:    underlying ≥ $441.50 OR premium ≤ -40%
Time:    exit by 12:30 ET if not at T1
```

Run-through with the system above:

1. Post lands at 8:00 AM ET → plan loader sees grade=`B+`. With `grade_filter=B+` (or `ALL`), it inserts a `bot_trades` row, `status=pending`, plan parsed into the AST in §6.
2. 9:30 open → trigger evaluator subscribes to TSLA quotes + 5-min bars + option-quote for `TSLA260512P00437500`.
3. 10:35 ET, the 10:30–10:35 bar closes at $437.42, and the bar's high tagged session VWAP ($440.18) before reversing → both predicates fire.
4. Risk engine: $4.80 mid × 100 = $480/contract. Above `max_risk_per_trade_usd=$250` → buy 0 contracts? No — sizing engine rounds down to `floor($250 / $480) = 0`. **Trade is risk-blocked**, logged as `risk_block`, `status=rejected`. Admin would need to raise the cap to act on this specific plan.
5. If cap were $500: buy 1 contract at $4.80 limit. OMS submits, fills at $4.78 → `status=open`, `entry_fill_usd=4.78`.
6. Trigger eval continues. At 11:12 ET underlying touches $432.10. `target1` fires. OMS submits sell-to-close limit at the prevailing mid. Fills at $7.91 → `status=closed`, `realized_pnl=313`. Logged.
7. If 12:30 hit first without T1: time-stop fires, sell-to-close, log `exit_time_stop`.
8. If $441.50 hit first: stop fires, sell-to-close, log `exit_stop_hit`.

Everything visible on the Matrix tape in real time.

---

## 12.5. Auto-tick (Railway cron)

The monitor is meaningless without something pinging it. `/api/cron/botwick/tick` is the entry point for any scheduled job — Railway cron, GitHub Actions, upstash QStash, anything that can `curl` with a bearer header.

**Auth**: `Authorization: Bearer ${BOTWICK_CRON_TOKEN}`. Different env var from `INGEST_API_KEY` so a leaked ingest key can't trigger orders. `lib/bearer.ts` exposes `requireBotwickCronBearer()`.

**Gate**: the endpoint returns `{ ok: true, skipped: true, phase: "weekend" | "pre_market" | "after_hours" }` outside regular trading hours (09:30–16:00 ET, Mon–Fri). No Tradier calls, no DB writes, no tape noise. The cron schedule SHOULD already restrict to market hours; this is defense-in-depth.

**Setup (one-time)**:
1. Generate a 32-byte token, set `BOTWICK_CRON_TOKEN` on the web service AND on a new "botwick-cron" Railway service.
2. Cron service runs `curl -fsS -X POST -H "Authorization: Bearer $BOTWICK_CRON_TOKEN" https://www.tradezerodte.com/api/cron/botwick/tick` on schedule.
3. Schedule: `* 13-19 * * 1-5` (every minute weekdays 13:30–20:00 UTC — covers 9:30–16:00 ET year-round; DST handled by Tradier's clock, not ours).
4. Admin UI's "Auto-tick (cron)" panel shows whether the token is set.

**Holidays**: not handled here. On Memorial Day the cron will still ping; the monitor sees an empty timesales response and skips gracefully. A few wasted Tradier calls — not bad behavior. A future calendar add-on can suppress on closed days.

## 12.6. Day-Trade Force Exit + stale-plan sweep

The bot is 0DTE-by-default. Two mechanisms ensure nothing rides overnight unintentionally:

### Force-exit at 15:55 ET (primary)

When `bot_config.day_trade_force_exit = true` (default), the first monitor tick to land in the window `15:55–15:59 ET, Mon–Fri` runs the force-exit sweep BEFORE any other phase:

| Trade status | Action |
|--------------|--------|
| `pending`, `signal_armed` | Local cancel → `status='cancelled'`, log `plan_expired` |
| `working` | Tradier `DELETE /accounts/{id}/orders/{id}` to cancel the in-flight entry → local cancel, log `order_cancelled` |
| `open` | Submit **MARKET** `sell_to_close` (no limit price) → `status='closing'`, log `force_exit`. Reconcile picks up the fill on the next tick → `status='closed'` with realized PnL |
| `closing`, terminal | Skipped — already on their way out or done |

After the sweep, the rest of the tick is skipped (no new entries get evaluated) but reconcile still runs to chase fills.

### Stale-plan sweep at ingest (fallback)

If force-exit didn't run (bot disabled overnight, cron down at 15:55, etc.), the ingest pipeline's first step is a sweep: any `pending` or `signal_armed` row whose `source_post_day < <ingest day>` gets force-cancelled with a `plan_expired` tape entry. This prevents yesterday's unfired plans from being evaluated against today's market.

**Important**: stale-plan sweep does NOT touch `open` positions. An overnight position is either intentional (force-exit was off) or a real ops failure worth human review — we don't silently market-close it during a routine ingest.

### When you'd disable Day-Trade Force Exit

Only if you intend to swing trades manually. With force-exit off, you take responsibility for closing positions before expiration / overnight risk. The bot will keep monitoring them via the plan's `time_stop` / target / stop predicates, but those are *your* exit instructions, not a daily reset.

## 13. Operational concerns

- **Secrets**: Tradier OAuth tokens live in Railway env vars (`TRADIER_SANDBOX_TOKEN`, `TRADIER_LIVE_TOKEN`, `TRADIER_ACCOUNT_ID`), never in the DB. The runner reads them at boot.
- **Single-runner mutex**: a Postgres advisory lock at runner start (`SELECT pg_try_advisory_lock(0xB07W1CK)`). Two runner instances can't both place orders.
- **Crash recovery**: on boot the runner reconciles every `working` and `open` trade against Tradier's `/v1/accounts/{id}/orders` and `/positions`. Any drift is logged as `error` severity.
- **Time sync**: runner refuses to start if local clock differs from NTP by > 500ms. Stale clocks miss bar-close events.
- **Order throttling**: max 1 order/second across the entire bot (configurable). Prevents API rate-limit storms during incidents.
- **Observability**: every `bot_actions` row is also shipped to stdout in JSON so Railway log search finds it. Daily summary email to admin at 4:05 PM ET.

---

## 14. What's NOT in scope (and why)

- **Multi-account routing** — design supports it (`bot_config` is singleton today, but `tradier_account_id` is a column), but launch with one account. Add multi-account only after Phase 5 proves stable.
- **Custom strategies beyond the trade-plan format** — every trade comes from a posted plan. We don't generate signals independently; the bot is an executor, not a researcher.
- **Crypto / futures** — Tradier doesn't trade these, and 0DTE crypto behaves differently. Out of scope.

---

## 15. Next concrete tickets

1. **Tradier client lib** (`lib/tradier.ts`): typed wrappers around `/markets`, `/accounts/{id}/orders`, `/accounts/{id}/positions`, plus a WS client for account events.
2. **Plan parser** (`lib/botwick/plan-parser.ts`): turns the natural-language entry/exit strings into the AST in §6. Start with regex + small grammar; LLM fallback for unrecognized phrases (with a "needs-review" flag so we don't ship anything we don't understand).
3. **Runner service** on Railway: TypeScript long-running process, `npm run runner:start`, reads `bot_config` every 5s, owns the trigger eval loop.
4. **OMS** (`lib/botwick/oms.ts`): the state-machine code from §8.
5. **Risk engine** (`lib/botwick/risk.ts`): the gates from §7.
6. **Backtest harness** (`scripts/backtest.ts`): replay historical posts.
7. **Streaming event broadcast to UI** (optional but nice): SSE endpoint that tails `bot_actions` so the Matrix tape updates without page reload.

---

## 16. Glossary

- **0DTE** — zero days to expiration; options that expire same day.
- **Mid** — midpoint of bid/ask, our default fair-value reference for limit pricing.
- **VWAP** — volume-weighted average price; intraday institutional reference level.
- **Greeks** — delta (directional), gamma (delta's delta), theta (time decay), vega (vol sensitivity).
- **IV rank / percentile** — implied volatility normalised vs. its own 1Y range.
- **Buying power (BP)** — broker's allowed leverage; spreads use less BP than naked positions.
