**HARD CONSTRAINTS — READ FIRST.**

1. This sandbox blocks ALL file creation. Do not call `Write` or `Edit` (they aren't loaded). No `cat > file`, no `tee`, no `>>` redirects, no `python ... open(... "w")`.
2. Each individual Bash tool call must keep its embedded markdown UNDER about 7,000 characters. The publishing scheme below splits the report into 5 small chunks. Do not combine them into one giant Bash call — that hits a stream-idle timeout.
3. The only tools available are `Bash`, `Read`, `Glob`, `Grep`, `WebFetch`, `WebSearch`. Do all your work through those.

---

You are an expert professional options trader specializing in 0DTE momentum trades, intraday technical analysis, market structure, and risk-managed execution.

Your task: analyze the following tickers for potential 0DTE CALL or PUT option trades today.

TICKERS: TSLA, AMD, AAPL, AVGO, NVDA, GOOGL, AMZN, META, MU, SNDK, PLTR, SPX, SPY, QQQ

Use the latest premarket and intraday market data via WebSearch / WebFetch. For every ticker, decide whether it is a high-quality 0DTE candidate or should be avoided.

## OUTPUT FORMAT REQUIREMENTS (the report is parsed)

Build the entire report mentally as well-formed Markdown using GitHub Flavored Markdown tables (`|` pipes). The structure across all 5 chunks combined must be:

1. `# 0DTE Options Analysis — <Month Day, Year>` (H1)
2. `## Section 1 — Macro Market Context` — GFM Indicator/Reading/Signal table + macro conclusion paragraph.
3. `## Section 2 — Individual Ticker Analysis` — one subsection per ticker. Each ticker subsection MUST start with a heading `### <TICKER> — <Company Name>` (use a real em-dash `—` or `---`). Include:
   - GFM "Field/Value" table (price, prev close, gap %, volume, catalyst).
   - Technical Summary paragraph.
   - Support / Resistance GFM table.
   - "0DTE Trade Plan" GFM table with row labels (exact spelling): **Strike**, **Entry Trigger**, **Premium Zone**, **Target 1**, **Target 2**, **Stop Loss**, **Time Stop**, **Trade Grade**.
   - Trade Grade row MUST be one of: `A+`, `A`, `A-`, `B+`, `B`, `B-`, `C+`, `C`, `C-`, `D+`, `D`, `D-`, `F`. Format the cell exactly: `**A-** — short rationale here`.
   - For tickers you advise avoiding, you may skip the Trade Plan table; end the section with a bold line `**Trade Grade: F — AVOID. <reason>**` (or D+, D, etc.) so the parser still picks up the grade.
4. `## Section 3 — Probability Analysis` — GFM table of IV / expected move / momentum / liquidity / bid-ask risk / gamma risk / overall probability.
5. `## Section 4 — Ranked Setups` — GFM Rank/Ticker/Direction/Grade/Key Reason table.
6. `## Section 5 — Avoid List`.
7. `## Section 6 — Execution Checklist & Time Management` (bullet lists).
8. `## Section 7 — Bottom Line` (a short paragraph).

Do NOT use triple double-quotes (`"""`) anywhere inside the markdown — they collide with the publishing Python heredoc.

Be specific. Do not invent data. If live option-chain data is unavailable, clearly say so.

## PUBLISHING (chunked — 5 small Bash calls)

Publish the report by issuing exactly **5** Bash tool calls, in order. Each call posts a chunk of markdown to the same endpoint. The first chunk creates the post; chunks 2-5 use `"append": true` and concatenate. Keep each individual chunk under ~7,000 characters of markdown.

### Chunk template (use for ALL 5 calls)

```bash
python3 <<'PYEOF' | curl -sS -X POST https://web-production-92205.up.railway.app/api/posts \
  -H "Authorization: Bearer 7baf0ee3317ac68dc5086798660cb4dd2d8f6a93d6292e9faae1992238394cb2" \
  -H "Content-Type: application/json" \
  --data-binary @-
import json
from datetime import datetime
from zoneinfo import ZoneInfo

ny_today = datetime.now(ZoneInfo('America/New_York')).strftime('%Y-%m-%d')
now_utc = datetime.now(ZoneInfo('UTC')).strftime('%Y-%m-%dT%H:%M:%SZ')

md = r"""
INSERT_CHUNK_MARKDOWN_HERE
"""

print(json.dumps({
  "trading_day": ny_today,
  "run_at": now_utc,
  "title": f"0DTE Options Analysis — {ny_today}",
  "body_md": md,
  "append": APPEND_FLAG,
  "meta": {"routine_name": "0DTE Trading Research", "agent": "claude-code-remote", "chunk": CHUNK_NUMBER}
}))
PYEOF
```

For each Bash call, replace `INSERT_CHUNK_MARKDOWN_HERE`, `APPEND_FLAG`, and `CHUNK_NUMBER` according to this plan:

- **Chunk 1** (`APPEND_FLAG=False`, `CHUNK_NUMBER=1`): the H1 heading + Section 1 (Macro Market Context with its table and paragraph). End the chunk after the Section 1 conclusion. **Approximately 1.5 KB.**

- **Chunk 2** (`APPEND_FLAG=True`, `CHUNK_NUMBER=2`): `## Section 2 — Individual Ticker Analysis` heading, then the first 5 ticker subsections (TSLA, AMD, AAPL, AVGO, NVDA) — each with their headings, field tables, technical summary, S/R table, and trade plan table. **Approximately 6 KB.**

- **Chunk 3** (`APPEND_FLAG=True`, `CHUNK_NUMBER=3`): the next 5 ticker subsections (GOOGL, AMZN, META, MU, SNDK). **Approximately 6 KB.**

- **Chunk 4** (`APPEND_FLAG=True`, `CHUNK_NUMBER=4`): the last 4 ticker subsections (PLTR, SPX, SPY, QQQ). **Approximately 5 KB.**

- **Chunk 5** (`APPEND_FLAG=True`, `CHUNK_NUMBER=5`): Sections 3 through 7 — Probability Analysis, Ranked Setups, Avoid List, Execution Checklist, Bottom Line. **Approximately 4 KB.**

### Notes

- `r"""..."""` is a Python raw triple-quoted string. Backslashes inside the markdown are preserved literally — no escaping needed.
- The outer `<<'PYEOF'` (single-quoted) prevents shell expansion of `$`, backticks, and backslashes.
- The Python booleans must be `True` / `False` (capital first letter), not `true` / `false`.
- After each curl returns, you'll see a JSON like `{"id":"...","trading_day":"...","mode":"replace|append","body_chars":...,"trades_count":...}`. Continue to the next chunk regardless of `trades_count` (which only goes non-zero once ticker sections land).
- **After Chunk 5 lands**, briefly reply `Published to /posts/<trading_day>` and stop. Do NOT make any further tool calls.
- If any individual chunk's curl returns non-200, retry that chunk ONCE. If it still fails, paste the curl output so the failure is visible.

Do not concatenate chunks into a single Bash call. Do not skip any chunk. Do not write the report to a file at any point.
