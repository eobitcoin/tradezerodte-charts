/**
 * Squeeze Scan — AI directional analysis for the top ideal setups.
 *
 * Runs ONCE per week inside the squeeze cron (never on page load). Takes the
 * cleanest ideal squeezes (bullish OR bearish mirror), and for each:
 *
 *   1. Enriches with an options-chain slice (~30-45 DTE) → spot + ATM IV +
 *      a concrete directional debit spread (call debit for long, put debit
 *      for short) built from real listed strikes, deep-linkable into Risk Graph.
 *   2. Asks Claude (Opus 4.8) for the likely release DIRECTION (long / short /
 *      neutral), a conviction, a "why", and an honest risk read.
 *
 * Best-effort: missing key or a failed call/chain leaves that pick without an
 * analysis (or without a trade), never fatal to the scan.
 */

import Anthropic from "@anthropic-ai/sdk";
import { fetchOptionChainSlice, type PolygonContract } from "@/lib/polygon";
import type {
  SqueezeUltraRow,
  SqueezeUltraSuggestion,
  SqueezeUltraOptionTrade,
} from "@/lib/db/schema";

const MODEL = "claude-opus-4-8";
const DTE_MIN = 25;
const DTE_MAX = 50;
const TARGET_DTE = 35;
const MAX_SUGGESTIONS = 3;

interface AnalystOutput {
  direction: "long" | "short" | "neutral";
  conviction: "high" | "medium" | "low";
  why: string;
  risk: string;
}

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    direction: {
      type: "string",
      enum: ["long", "short", "neutral"],
      description:
        "The most likely direction the squeeze releases. The indicator's ideal flag is a directional base case, but call neutral if momentum/structure genuinely conflicts.",
    },
    conviction: { type: "string", enum: ["high", "medium", "low"] },
    why: {
      type: "string",
      description:
        "2-4 sentences: why the squeeze is likely to release this way, referencing the Daily/Weekly squeeze tightness, momentum colour, EMA stack, and timeframe alignment. Analytical, not promotional.",
    },
    risk: {
      type: "string",
      description:
        "2-3 sentences: the honest risk — a squeeze can release either way; name the specific failure mode and what would invalidate the direction.",
    },
  },
  required: ["direction", "conviction", "why", "risk"],
} as const;

function midOf(c: PolygonContract): number | null {
  const bid = typeof c.last_quote?.bid === "number" && c.last_quote.bid > 0 ? c.last_quote.bid : null;
  const ask = typeof c.last_quote?.ask === "number" && c.last_quote.ask > 0 ? c.last_quote.ask : null;
  if (bid != null && ask != null && ask >= bid) return (bid + ask) / 2;
  if (typeof c.last_quote?.midpoint === "number" && c.last_quote.midpoint > 0) return c.last_quote.midpoint;
  return null;
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

interface ChainContext {
  spot: number;
  atmIv: number | null;
  targetExpiry: string;
  dteDays: number;
  contracts: PolygonContract[];
}

async function fetchChainContext(symbol: string, fallbackSpot: number, today: string): Promise<ChainContext | null> {
  const gte = (() => { const d = new Date(today + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + DTE_MIN - 3); return d.toISOString().slice(0, 10); })();
  const lte = (() => { const d = new Date(today + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + DTE_MAX); return d.toISOString().slice(0, 10); })();
  const contracts = await fetchOptionChainSlice(symbol, {
    expirationGte: gte,
    expirationLte: lte,
    strikeGte: Math.floor(fallbackSpot * 0.82),
    strikeLte: Math.ceil(fallbackSpot * 1.18),
    limit: 250,
  });
  if (contracts.length === 0) return null;

  const spot = contracts.find((c) => typeof c.underlying_asset?.price === "number" && c.underlying_asset.price! > 0)
    ?.underlying_asset?.price ?? fallbackSpot;

  const expiries = Array.from(new Set(contracts.map((c) => c.details.expiration_date)))
    .map((e) => ({ e, dte: daysBetween(today, e) }))
    .filter((x) => x.dte >= DTE_MIN && x.dte <= DTE_MAX);
  if (expiries.length === 0) return null;
  const target = expiries.sort((a, b) => Math.abs(a.dte - TARGET_DTE) - Math.abs(b.dte - TARGET_DTE))[0];

  const atExp = contracts.filter((c) => c.details.expiration_date === target.e);
  const nearest = (type: "call" | "put") =>
    atExp
      .filter((c) => c.details.contract_type === type && typeof c.implied_volatility === "number" && c.implied_volatility! > 0)
      .reduce<PolygonContract | null>((best, c) => {
        if (!best) return c;
        return Math.abs(c.details.strike_price - spot) < Math.abs(best.details.strike_price - spot) ? c : best;
      }, null);
  const ivs = [nearest("call")?.implied_volatility, nearest("put")?.implied_volatility].filter(
    (v): v is number => typeof v === "number" && v > 0,
  );
  const atmIv = ivs.length ? Math.round((ivs.reduce((s, v) => s + v, 0) / ivs.length) * 10000) / 10000 : null;

  return { spot, atmIv, targetExpiry: target.e, dteDays: target.dte, contracts: atExp };
}

/** Build a directional debit spread (call debit = long, put debit = short). */
function buildDebitSpread(ctx: ChainContext, direction: "long" | "short"): SqueezeUltraOptionTrade | null {
  const type = direction === "long" ? "call" : "put";
  const legs = ctx.contracts
    .filter((c) => c.details.contract_type === type && midOf(c) != null)
    .sort((a, b) => a.details.strike_price - b.details.strike_price);
  if (legs.length < 2) return null;

  const nearestTo = (target: number) =>
    legs.reduce<PolygonContract | null>((best, c) => {
      if (!best) return c;
      return Math.abs(c.details.strike_price - target) < Math.abs(best.details.strike_price - target) ? c : best;
    }, null);

  // Long leg ≈ ATM; short leg ≈ 6% in the trade's favour.
  const longLeg = nearestTo(ctx.spot);
  if (!longLeg) return null;
  const target = direction === "long" ? ctx.spot * 1.06 : ctx.spot * 0.94;
  const shortLeg = nearestTo(target);
  if (!shortLeg) return null;

  const longStrike = longLeg.details.strike_price;
  const shortStrike = shortLeg.details.strike_price;
  // Directional ordering: calls short above long; puts short below long.
  if (direction === "long" && !(shortStrike > longStrike)) return null;
  if (direction === "short" && !(shortStrike < longStrike)) return null;

  const longMid = midOf(longLeg)!;
  const shortMid = midOf(shortLeg)!;
  const netDebit = Math.round((longMid - shortMid) * 100) / 100;
  if (netDebit <= 0) return null;
  const width = Math.round(Math.abs(longStrike - shortStrike) * 100) / 100;
  const breakeven =
    direction === "long"
      ? Math.round((longStrike + netDebit) * 100) / 100
      : Math.round((longStrike - netDebit) * 100) / 100;

  return {
    strategy: direction === "long" ? "call_debit_spread" : "put_debit_spread",
    direction,
    expiration: ctx.targetExpiry,
    dteDays: ctx.dteDays,
    longStrike,
    shortStrike,
    netDebit,
    width,
    maxProfit: Math.round((width - netDebit) * 100 * 100) / 100,
    maxLoss: Math.round(netDebit * 100 * 100) / 100,
    breakeven,
    longContractTicker: longLeg.details.ticker,
    shortContractTicker: shortLeg.details.ticker,
  };
}

function fmtTf(label: "Daily" | "Weekly", tf: SqueezeUltraRow["daily"]): string {
  if (!tf.inSqueeze)
    return `${label}: no squeeze (state ${tf.state ?? "—"}, momentum ${tf.momColor ?? "—"})`;
  const stateName = tf.state === 3 ? "Tight" : tf.state === 2 ? "Mid" : "Wide";
  const ideal = tf.ideal ? ", BULLISH ideal (EMA stacked up)" : tf.idealShort ? ", BEARISH ideal (EMA stacked down)" : "";
  return `${label}: ${stateName} squeeze${ideal}, momentum ${tf.momColor ?? "—"}`;
}

function buildPrompt(s: { symbol: string; price: number; daily: SqueezeUltraRow["daily"]; weekly: SqueezeUltraRow["weekly"]; idealBias: "long" | "short"; atmIv: number | null }): string {
  const ivLine = s.atmIv != null ? `${(s.atmIv * 100).toFixed(0)}% 30d ATM implied vol` : "implied vol unavailable";
  return [
    `You are a technical analyst reading a TTM-style "squeeze" (Bollinger Bands compressed inside Keltner Channels — volatility coiling for an expansion move). This is a breakout/volatility-expansion context, NOT premium selling. Be analytical and risk-honest; do not give personalized financial advice.`,
    ``,
    `Ticker: ${s.symbol} at $${s.price.toFixed(2)} (${ivLine}).`,
    fmtTf("Daily", s.daily),
    fmtTf("Weekly", s.weekly),
    `Indicator directional base case (from the EMA stack): ${s.idealBias.toUpperCase()}.`,
    ``,
    `Momentum colours: cyan = up & accelerating, blue = up & fading, yellow = down & improving, red = down & accelerating.`,
    `An "ideal" squeeze is the engine's clean continuation setup — stacked, sloping EMAs with a Mid-tightness squeeze — pointing ${s.idealBias}. But a squeeze can release either way; weigh the momentum colours and Daily/Weekly agreement before committing to a direction.`,
    ``,
    `Return JSON: direction (long/short/neutral — your call for the likely release), conviction (high/medium/low), why (the directional thesis), and risk (how it fails / what invalidates it).`,
  ].join("\n");
}

/** Pick the indicator bias for a row: weekly ideal dominates daily; long preferred on ties. */
function biasOf(r: SqueezeUltraRow): "long" | "short" | null {
  if (r.weekly.ideal) return "long";
  if (r.weekly.idealShort) return "short";
  if (r.daily.ideal) return "long";
  if (r.daily.idealShort) return "short";
  return null;
}

/** Rank candidates: both-timeframe ideal first, then tightest, then volume. */
function candidateScore(r: SqueezeUltraRow): number {
  const longBoth = r.daily.ideal && r.weekly.ideal;
  const shortBoth = r.daily.idealShort && r.weekly.idealShort;
  const bothTf = longBoth || shortBoth ? 100 : 0;
  const tight = Math.max(r.daily.state ?? 0, r.weekly.state ?? 0) * 10;
  return bothTf + tight;
}

export async function analyzeSqueezeSetups(
  rows: SqueezeUltraRow[],
  today: string,
): Promise<SqueezeUltraSuggestion[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];

  // Candidate pool: any ideal (long or short) on either timeframe.
  const pool = rows
    .map((r) => ({ r, bias: biasOf(r) }))
    .filter((x): x is { r: SqueezeUltraRow; bias: "long" | "short" } => x.bias != null)
    .sort((a, b) => candidateScore(b.r) - candidateScore(a.r) || b.r.dayVolume - a.r.dayVolume)
    .slice(0, MAX_SUGGESTIONS);
  if (pool.length === 0) return [];

  const client = new Anthropic();

  const out = await Promise.all(
    pool.map(async ({ r, bias }): Promise<SqueezeUltraSuggestion | null> => {
      try {
        const ctx = await fetchChainContext(r.symbol, r.price, today).catch(() => null);
        const atmIv = ctx?.atmIv ?? null;

        const response = await client.messages.create({
          model: MODEL,
          max_tokens: 1024,
          thinking: { type: "adaptive" },
          system:
            "You write concise, neutral, risk-focused technical analysis of squeeze (volatility-compression) setups for an educational research dashboard. Never give personalized financial advice.",
          output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
          messages: [
            { role: "user", content: buildPrompt({ symbol: r.symbol, price: r.price, daily: r.daily, weekly: r.weekly, idealBias: bias, atmIv }) },
          ],
        });
        const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
        if (!textBlock) return null;
        const parsed = JSON.parse(textBlock.text) as AnalystOutput;
        if (!parsed.direction || !parsed.why) return null;

        // Build the trade in the AI's direction (fall back to indicator bias if neutral).
        const tradeDir = parsed.direction === "neutral" ? bias : parsed.direction;
        const optionTrade = ctx ? buildDebitSpread(ctx, tradeDir) : null;

        return {
          symbol: r.symbol,
          price: r.price,
          daily: r.daily,
          weekly: r.weekly,
          atmIv,
          idealBias: bias,
          aiAnalysis: {
            direction: parsed.direction,
            conviction: parsed.conviction ?? "medium",
            why: parsed.why.trim(),
            risk: (parsed.risk ?? "").trim(),
            model: MODEL,
          },
          optionTrade,
        };
      } catch {
        return null;
      }
    }),
  );

  return out.filter((s): s is SqueezeUltraSuggestion => s != null);
}
