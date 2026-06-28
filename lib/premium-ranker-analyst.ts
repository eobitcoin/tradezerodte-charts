/**
 * Premium Ranker — AI analysis for the 3 headline picks.
 *
 * Runs ONCE per week inside the Premium Ranker cron (never on page load).
 * For each of the (up to) 3 suggestions it asks Claude two things:
 *
 *   1. WHY this is/isn't an attractive premium-selling setup.
 *   2. An honest PROBABILITY / risk read that contextualizes the
 *      risk-neutral PoP the scan already computed.
 *
 * Each pick is enriched first with a Finnhub earnings-calendar check across
 * the trade's DTE window — an earnings report inside the window is the single
 * biggest reason IV (and therefore premium) is elevated, so the model is told
 * about it explicitly rather than left to guess.
 *
 * Cost is negligible: ≤3 model calls per weekly run. We use Claude Opus 4.8
 * (the project's default tier) for the financial reasoning. The whole step is
 * best-effort — if the key is missing or a call fails, the suggestion simply
 * keeps its deterministic `thesis` and renders without the AI block.
 */

import Anthropic from "@anthropic-ai/sdk";
import { fetchUpcomingEarnings } from "@/lib/finnhub";
import type { PremiumRankerSuggestion } from "@/lib/db/schema";

const MODEL = "claude-opus-4-8";

/** Structured shape we force the model to return, per pick. */
interface AnalystOutput {
  why: string;
  probability: string;
}

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    why: {
      type: "string",
      description:
        "2-4 sentences on why this is (or isn't) an attractive premium-selling setup. Reference the concrete IV, premium, and any earnings-in-window driver. Analytical, not prescriptive.",
    },
    probability: {
      type: "string",
      description:
        "2-3 sentences giving an honest probability/risk read. Contextualize the model-computed probability of profit: what it does and doesn't account for (it's risk-neutral, ignores fat tails / gaps / assignment). State the main way this trade loses.",
    },
  },
  required: ["why", "probability"],
} as const;

/** Does an earnings report fall inside [today, expiration]? null if lookup failed. */
async function earningsInWindow(
  symbol: string,
  today: string,
  expiration: string,
): Promise<boolean | null> {
  try {
    const events = await fetchUpcomingEarnings({ from: today, to: expiration, symbol });
    return events.some((e) => e.symbol === symbol.toUpperCase() && e.date >= today && e.date <= expiration);
  } catch {
    return null;
  }
}

function buildPrompt(s: PremiumRankerSuggestion, hasEarnings: boolean | null): string {
  const np = s.nakedPut;
  const cs = s.creditSpread;
  const ivPct = (s.atmIv * 100).toFixed(0);
  const popPct = np.probabilityOfProfit != null ? (np.probabilityOfProfit * 100).toFixed(0) : "unknown";
  const annPct = np.annualizedReturnPct != null ? np.annualizedReturnPct.toFixed(0) : "unknown";
  const earningsLine =
    hasEarnings === true
      ? `An earnings report DOES fall inside the trade window (before the ${np.expiration} expiration) — this is very likely the reason IV/premium is elevated and is a major risk.`
      : hasEarnings === false
      ? `No earnings report falls inside the trade window, so the elevated IV is NOT a scheduled-earnings effect (could be a pending event, sector move, or a falling knife).`
      : `Earnings-calendar data was unavailable, so whether an earnings report falls in the window is unknown — treat event risk as uncertain.`;

  return [
    `You are a derivatives risk analyst writing a brief, neutral read on a premium-selling setup surfaced by a quantitative scanner. Be analytical and risk-honest, not promotional. Do NOT give buy/sell advice or position-sizing instructions — describe the setup and its risks.`,
    ``,
    `Underlying: ${s.symbol} at $${s.price.toFixed(2)}`,
    `30d ATM implied volatility: ${ivPct}%`,
    `Headline trade — cash-secured short put: sell the ${np.strike} put expiring ${np.expiration} (${np.dteDays} DTE) for $${np.credit.toFixed(2)} credit.`,
    `  Breakeven $${np.breakeven.toFixed(2)}, annualized return on risk ~${annPct}%, scanner probability of profit ~${popPct}% (risk-neutral N(d2) at breakeven).`,
    cs
      ? `Defined-risk alternative — ${cs.shortStrike}/${cs.longStrike} put credit spread for $${cs.netCredit.toFixed(2)} net credit (max profit $${cs.maxProfit.toFixed(0)}, max loss $${cs.maxLoss.toFixed(0)}).`
      : `No clean defined-risk credit spread was available below the short strike.`,
    earningsLine,
    ``,
    `Return JSON with two fields: "why" (why this is/isn't attractive for premium selling) and "probability" (an honest probability/risk read).`,
  ].join("\n");
}

/**
 * Generate AI analysis for the given suggestions in place, returning a NEW
 * array (does not mutate the input). Best-effort: any pick whose call fails
 * is returned unchanged. If ANTHROPIC_API_KEY is unset, returns the input
 * untouched.
 */
export async function analyzeSuggestions(
  suggestions: PremiumRankerSuggestion[],
  today: string,
): Promise<PremiumRankerSuggestion[]> {
  if (!process.env.ANTHROPIC_API_KEY || suggestions.length === 0) return suggestions;

  const client = new Anthropic();

  return Promise.all(
    suggestions.map(async (s) => {
      try {
        const hasEarnings = await earningsInWindow(s.symbol, today, s.nakedPut.expiration);
        const response = await client.messages.create({
          model: MODEL,
          max_tokens: 1024,
          thinking: { type: "adaptive" },
          system:
            "You write concise, neutral, risk-focused analysis of options-selling setups for an educational research dashboard. Never give personalized financial advice.",
          output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
          messages: [{ role: "user", content: buildPrompt(s, hasEarnings) }],
        });

        const textBlock = response.content.find(
          (b): b is Anthropic.TextBlock => b.type === "text",
        );
        if (!textBlock) return s;
        const parsed = JSON.parse(textBlock.text) as AnalystOutput;
        if (!parsed.why || !parsed.probability) return s;

        return {
          ...s,
          aiAnalysis: {
            why: parsed.why.trim(),
            probability: parsed.probability.trim(),
            earningsInWindow: hasEarnings,
            model: MODEL,
          },
        };
      } catch {
        return s; // best-effort — keep the deterministic thesis
      }
    }),
  );
}
