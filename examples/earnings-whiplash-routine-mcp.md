# Earnings Whiplash Map — weekly routine prompt

## Schedule
**Weekly · Sunday · 5:00 PM ET** (2200 UTC May–Oct, 2100 UTC Nov–Apr).

Runs once per week, covers the upcoming 14 trading days of S&P 500 earnings reports.

## Tools required
- `fetch_earnings_whiplash` — pulls earnings calendar for S&P 500 over the next 14 days
- `fetch_bars` — Tradier OHLC, used in narrow lookback only
- `fetch_quote` — current price snapshot
- `fetch_options_snapshot` — for implied move estimation (front-month ATM straddle)
- `publish_earnings_whiplash` — final write to DB

## Constraints (critical to prevent hangs)

1. **Bars window: 14 trading days only.** Use `fetch_bars(ticker, kind="daily", days=14)`.
   Past attempts requesting 60+ days generated tool-result files large enough to choke
   the agent's bash sandbox.
2. **Process bars inline.** Do NOT copy/move tool-result files between locations. The
   tool result is already in your context — analyze it directly.
3. **Do NOT use WebFetch** for earnings calendar. Use `fetch_earnings_whiplash` (which
   returns the calendar + ticker metadata in one call).
4. **Skip any ticker whose chain or bars fail to fetch.** Don't retry — just log and move
   to the next name. The publish call accepts as few as 4 stocks.
5. **One publish call per run.** Do not call `publish_earnings_whiplash` more than once
   per scan_day, even on retry.

## Workflow

### Step 1 — Get the calendar
Call `fetch_earnings_whiplash` (no arguments needed — defaults to S&P 500 ∩ next 14 days).
Returns: array of `{ticker, earningsDate, reportTime, sector, marketCapUsdB, companyName}`.

### Step 2 — For each ticker (parallel up to 4 at a time)
```
fetch_quote(ticker)         → current price + bid/ask
fetch_bars(ticker, kind="daily", days=14)  → recent realized move stats
fetch_options_snapshot(ticker, "earnings")  → front-month ATM straddle for implied move
```

If any of the 3 fail, skip the ticker entirely.

### Step 3 — Compute the asymmetry score

**Preferred methodology — historical earnings moves (8-quarter lookback):**

For each ticker that succeeded:

- **Realized move**: pull the last 8 quarterly earnings dates from `fetch_earnings_whiplash`
  metadata (it includes priorEarningsDates). For each, look at the close-to-close return
  from the day BEFORE the announcement to the day OF the post-announcement reaction
  (use `fetch_bars` with explicit `start`/`end` for that 2-day window — keeps the bars
  payload tiny). Take the mean of |return| across the 8 events.
- **Implied move**: front-month ATM straddle ÷ spot × 100. Get this from
  `fetch_option_contract` calls on the nearest-expiry ATM call + put (not
  `fetch_options_snapshot` — that returns max-pain/GEX aggregates, not raw straddle).
- **Asymmetry (in percentage points)**: `realized - implied`. Positive = IV is cheap
  vs how the stock actually moves on earnings.

**Flagging rule**: `isFlagged=true` only for the top-3 names where asymmetry ≥ −1.5pp
(IV is at or below historical average). On weeks where NO ticker meets this bar
(premium-selling regime), flag 0 names — do not force 3 picks just to fill the slot.

**Fallback if 8-quarter lookup fails**: use stdev of daily |return| over 14 trading days
× √(252/14). Note in the methodology summary that you fell back. Don't fail the
whole run.

### Step 4 — Build the summary + methodology
- Summary: 1-2 paragraphs naming the 3 flagged setups and the calendar window.
- Methodology: 1 paragraph describing the lookback + threshold.

### Step 5 — Single publish call
```
publish_earnings_whiplash({
  scan_day: today_in_NY,
  summary,
  methodology,
  stocks: [
    { ticker, companyName, sector, marketCapUsdB, ... isFlagged: true/false },
    ...
  ]  // ranked by realized-move size descending
})
```

## Failure modes that previously stuck the routine

| Symptom | Old behavior | New behavior |
|---|---|---|
| `fetch_bars` returns "tool not available" | Spent 5+ tool calls hunting via ToolSearch | Listed required tools above; load all upfront via `select:fetch_bars,fetch_quote,...` |
| Bars file too big to `cp` | Copied tool results to /tmp, hung on cp | Process inline; never move tool results |
| Calendar fetched via WebFetch | Slow, brittle, often blocked by CAPTCHA | Use `fetch_earnings_whiplash` |
| Sub-task fails on 1 ticker → routine retries forever | No skip logic | Explicit skip-on-error per ticker |

## Output expectations

- Database row in `earnings_posts` table with today's `scan_day`
- 4-10 stocks ranked by realized-move size
- Exactly 3 stocks flagged with `isFlagged=true`
- Page rendered at `/research/earnings`

## Recovery if the routine hangs again

1. Stop the stuck remote agent at [claude.ai/code/routines](https://claude.ai/code/routines)
2. Manually trigger another run from the same page
3. If it hangs at the same step, the issue is in the prompt — escalate to dev
