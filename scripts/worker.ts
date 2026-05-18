#!/usr/bin/env tsx
/**
 * Railway cron worker — runs the user's research routines and publishes the result
 * to the web app. Replaces the claude.ai scheduled routines (which were blocked by
 * the CCR egress allowlist).
 *
 * Usage:
 *   tsx scripts/worker.ts dte       # 0DTE Trading Research
 *   tsx scripts/worker.ts insider   # SEC Form 4 Insider Scanner
 *
 * Required env:
 *   ANTHROPIC_API_KEY   — user's Anthropic API key (calls Messages API directly)
 *   INGEST_API_KEY      — bearer token for our /api/posts and /api/insider/posts
 *   APP_URL             — defaults to https://web-production-92205.up.railway.app
 */

import Anthropic from "@anthropic-ai/sdk";

const routine = process.argv[2];
if (!routine || !["dte", "insider"].includes(routine)) {
  console.error("Usage: tsx scripts/worker.ts <dte|insider>");
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is required");
  process.exit(1);
}
if (!process.env.INGEST_API_KEY) {
  console.error("INGEST_API_KEY is required");
  process.exit(1);
}

const APP_URL = (process.env.APP_URL || "https://web-production-92205.up.railway.app").replace(/\/$/, "");
const client = new Anthropic();

function nyTodayDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function nyTodayLong(): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date());
}

const DTE_PROMPT = `You are an expert professional options trader specializing in 0DTE momentum trades, intraday technical analysis, market structure, and risk-managed execution.

Your task: analyze the following tickers for potential 0DTE CALL or PUT option trades today (${nyTodayLong()}).

TICKERS: TSLA, AMD, AAPL, AVGO, NVDA, GOOGL, AMZN, META, MU, SNDK, PLTR, SPX, SPY, QQQ

Use the latest premarket and intraday market data via the web_search tool. For every ticker, decide whether it is a high-quality 0DTE candidate or should be avoided.

## OUTPUT FORMAT REQUIREMENTS (the report is parsed by code — follow exactly)

Produce ONE markdown document using GitHub Flavored Markdown tables (\`|\` pipes). Output only the markdown report — no preamble, no code fences around the whole thing, no chat-style commentary. Structure:

1. \`# 0DTE Options Analysis — <Month Day, Year>\` (H1)
2. \`## Section 1 — Macro Market Context\` — GFM Indicator/Reading/Signal table + macro conclusion paragraph.
3. \`## Section 2 — Individual Ticker Analysis\` — one subsection per ticker. Each ticker subsection MUST start with a heading \`### <TICKER> — <Company Name>\` (use a real em-dash \`—\` or \`---\`). Include:
   - GFM "Field/Value" table (price, prev close, gap %, volume, catalyst).
   - Technical Summary paragraph.
   - Support / Resistance GFM table.
   - "0DTE Trade Plan" GFM table with row labels (exact spelling): **Strike**, **Entry Trigger**, **Premium Zone**, **Target 1**, **Target 2**, **Stop Loss**, **Time Stop**, **Trade Grade**.
   - Trade Grade row MUST be one of: \`A+\`, \`A\`, \`A-\`, \`B+\`, \`B\`, \`B-\`, \`C+\`, \`C\`, \`C-\`, \`D+\`, \`D\`, \`D-\`, \`F\`. Format the cell exactly: \`**A-** — short rationale here\`.
   - For tickers you advise avoiding, you may skip the Trade Plan table; end the section with a bold line \`**Trade Grade: F — AVOID. <reason>**\` (or D+, D, etc.) so the parser still picks up the grade.
4. \`## Section 3 — Probability Analysis\` — GFM table of IV / expected move / momentum / liquidity / bid-ask risk / gamma risk / overall probability.
5. \`## Section 4 — Ranked Setups\` — GFM Rank/Ticker/Direction/Grade/Key Reason table.
6. \`## Section 5 — Avoid List\`.
7. \`## Section 6 — Execution Checklist & Time Management\` (bullet lists).
8. \`## Section 7 — Bottom Line\` (a short paragraph).

Be specific. Do not invent data. If live option-chain data is unavailable, clearly say so. Confirm SPY, QQQ, VIX, Nasdaq futures, VWAP, and market breadth before recommending entries.`;

const INSIDER_PROMPT = `You are an SEC Form 4 insider-buying scanner. Today: ${nyTodayLong()}.

## What to find

Use the web_search tool to identify meaningful insider purchases at U.S. publicly traded companies in the **last 24 hours**. Sources: SEC EDGAR full-text search, openinsider.com, Finviz insider feed, etc.

Filters:
- Form type: **Form 4**
- Filed within the **last 24 hours**
- Transaction type: **\`P\` (open-market PURCHASE)** — exclude sales, option exercises, gifts, conversions, RSU vests
- Total transaction value: **≥ $250,000**

Skip token purchases under $250k. Rank results by total_value, largest first.

## What to extract per qualifying buy

For every qualifying filing, capture:
- **ticker** (uppercase symbol)
- **company** (full registered name)
- **executive** (the reporting insider's full name)
- **title** (their role: CEO, CFO, Director, 10% Owner, etc.)
- **shares** (integer share count)
- **total_value** (USD value as a plain integer)
- **position_type**: "new" if first reported holding, "addition" if adding to existing
- **filing_url** (canonical SEC URL, if available)
- **notes** (any additional context: weighted avg price, post-earnings timing, cluster activity, etc.)

## Output

Call the \`publish_insider_scan\` tool exactly once with:
- A short markdown body summarising the scan: how many qualifying buys, total combined dollar value, headline filings, brief commentary.
- A structured JSON array of all buys.

If there are zero qualifying filings, call the tool with an empty buys array and a brief markdown saying so.`;

async function runDte() {
  console.log(`[worker:dte] starting — model=claude-opus-4-7 effort=high`);
  const start = Date.now();

  const stream = client.messages.stream({
    model: "claude-opus-4-7",
    max_tokens: 64000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    tools: [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { type: "web_search_20260209", name: "web_search" } as any,
    ],
    messages: [{ role: "user", content: DTE_PROMPT }],
  });

  // Light-touch progress logging
  stream.on("text", (delta) => {
    process.stdout.write(delta);
  });

  const finalMessage = await stream.finalMessage();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n[worker:dte] message complete in ${elapsed}s, stop_reason=${finalMessage.stop_reason}`);
  console.log(`[worker:dte] usage: input=${finalMessage.usage.input_tokens} output=${finalMessage.usage.output_tokens}`);

  const markdown = finalMessage.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n\n");

  if (!markdown.trim()) {
    console.error("[worker:dte] empty markdown response");
    process.exit(1);
  }

  const tradingDay = nyTodayDate();
  const res = await fetch(`${APP_URL}/api/posts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.INGEST_API_KEY}`,
    },
    body: JSON.stringify({
      title: `0DTE Options Analysis — ${nyTodayLong()}`,
      trading_day: tradingDay,
      run_at: new Date().toISOString(),
      body_md: markdown,
      meta: {
        routine_name: "0DTE Trading Research",
        agent: "railway-worker",
        model: "claude-opus-4-7",
      },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error(`[worker:dte] POST failed: HTTP ${res.status}`, data);
    process.exit(1);
  }
  console.log(`[worker:dte] published: ${JSON.stringify(data)}`);
}

async function runInsider() {
  console.log(`[worker:insider] starting — model=claude-opus-4-7 effort=high`);
  const start = Date.now();

  const finalMessage = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    tools: [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { type: "web_search_20260209", name: "web_search" } as any,
      {
        name: "publish_insider_scan",
        description: "Submit the day's qualifying insider buys + a markdown summary. Call exactly once at the end.",
        input_schema: {
          type: "object",
          properties: {
            body_md: {
              type: "string",
              description: "A short markdown summary (1-2 sections, ~200-500 words).",
            },
            buys: {
              type: "array",
              description: "All qualifying buys, sorted by total_value descending.",
              items: {
                type: "object",
                properties: {
                  ticker: { type: "string" },
                  company: { type: "string" },
                  executive: { type: "string" },
                  title: { type: "string" },
                  shares: { type: "integer" },
                  total_value: { type: "integer" },
                  position_type: { type: "string", enum: ["new", "addition"] },
                  filing_date: { type: "string", description: "YYYY-MM-DD" },
                  filing_url: { type: "string" },
                  notes: { type: "string" },
                },
                required: ["ticker", "company", "executive"],
              },
            },
          },
          required: ["body_md", "buys"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "publish_insider_scan" },
    messages: [{ role: "user", content: INSIDER_PROMPT }],
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[worker:insider] message complete in ${elapsed}s, stop_reason=${finalMessage.stop_reason}`);
  console.log(`[worker:insider] usage: input=${finalMessage.usage.input_tokens} output=${finalMessage.usage.output_tokens}`);

  const toolUse = finalMessage.content.find((b) => b.type === "tool_use" && b.name === "publish_insider_scan");
  if (!toolUse || toolUse.type !== "tool_use") {
    console.error("[worker:insider] agent did not call publish_insider_scan tool");
    console.error("[worker:insider] full response:", JSON.stringify(finalMessage.content, null, 2));
    process.exit(1);
  }
  const input = toolUse.input as { body_md: string; buys: unknown[] };

  const scanDay = nyTodayDate();
  const res = await fetch(`${APP_URL}/api/insider/posts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.INGEST_API_KEY}`,
    },
    body: JSON.stringify({
      title: `SEC Form 4 Insider Scan — ${nyTodayLong()}`,
      scan_day: scanDay,
      run_at: new Date().toISOString(),
      body_md: input.body_md,
      buys: input.buys,
      meta: {
        routine_name: "SEC Form 4 Insider Scanner",
        agent: "railway-worker",
        model: "claude-opus-4-7",
      },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error(`[worker:insider] POST failed: HTTP ${res.status}`, data);
    process.exit(1);
  }
  console.log(`[worker:insider] published: ${JSON.stringify(data)}`);
}

async function main() {
  if (routine === "dte") await runDte();
  else await runInsider();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
