/**
 * Parity check: TS Finora engine (lib/finora-engine.ts) vs the Python
 * reference (.claude/skills/finora-ai/scripts/finora_analyze.py).
 *
 * Golden vectors (scripts/finora_golden.json) hold synthetic + real-capture
 * OHLCV series with the Python engine's outputs. This runs the TS port over
 * the SAME bars and asserts: every indicator verdict + ADX value, every level
 * (swing/EQ/resistance/support/clusters/imbalances), trend, and price action.
 *
 * Run:  node scripts/verify-finora-engine.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, "finora_golden.json"), "utf8"));
const { indicatorVerdicts, levelsBlock, trendBlock, priceActionBlock, netBias } = await import(
  join(here, "..", "lib", "finora-engine.ts")
);

let failures = 0;
let checked = 0;
const fail = (c, what, ts, py) => {
  console.log(`[${c}] ${what}: TS=${JSON.stringify(ts)} PY=${JSON.stringify(py)}`);
  failures++;
};
const eq = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

for (const c of golden) {
  const bars = c.bars.map((b, i) => ({ date: String(i), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));

  // Indicators
  const iv = indicatorVerdicts(bars);
  for (const key of ["MACD", "Vortex", "PSAR", "DMI", "Stochastic", "Momentum", "RSI", "MFI", "Fisher"]) {
    checked++;
    if (iv[key].verdict !== c.indicators[key].verdict) fail(c.name, `${key} verdict`, iv[key], c.indicators[key]);
  }
  checked++;
  if (iv.ADX.verdict !== c.indicators.ADX.verdict || !eq(iv.ADX.value, c.indicators.ADX.value, 0.05))
    fail(c.name, "ADX", iv.ADX, c.indicators.ADX);

  // Levels
  const lv = levelsBlock(bars, c.price);
  checked += 3;
  if (!eq(lv.swingHigh, c.levels.swing_high, 0.01)) fail(c.name, "swingHigh", lv.swingHigh, c.levels.swing_high);
  if (!eq(lv.swingLow, c.levels.swing_low, 0.01)) fail(c.name, "swingLow", lv.swingLow, c.levels.swing_low);
  if (!eq(lv.equilibrium, c.levels.equilibrium, 0.01)) fail(c.name, "equilibrium", lv.equilibrium, c.levels.equilibrium);
  checked += 2;
  if (JSON.stringify(lv.resistance) !== JSON.stringify(c.levels.resistance))
    fail(c.name, "resistance", lv.resistance, c.levels.resistance);
  if (JSON.stringify(lv.support) !== JSON.stringify(c.levels.support))
    fail(c.name, "support", lv.support, c.levels.support);
  checked += 2;
  const tsClusters = lv.clusters.map((x) => `${x.low}-${x.high}x${x.touches}`).join(",");
  const pyClusters = c.levels.clusters.map((x) => `${x.low}-${x.high}x${x.touches}`).join(",");
  if (tsClusters !== pyClusters) fail(c.name, "clusters", tsClusters, pyClusters);
  const tsImb = lv.imbalances.map((x) => `${x.type}:${x.low}-${x.high}`).sort().join(",");
  const pyImb = c.levels.imbalances.map((x) => `${x.type}:${x.low}-${x.high}`).sort().join(",");
  if (tsImb !== pyImb) fail(c.name, "imbalances", tsImb, pyImb);

  // Trend + price action
  const tb = trendBlock(bars);
  checked += 2;
  if (tb.trend !== c.trend.trend || tb.structure !== c.trend.structure)
    fail(c.name, "trend", tb, c.trend);
  if (!eq(tb.ema20, c.trend.ema20, 0.01) || !eq(tb.ema50, c.trend.ema50, 0.01))
    fail(c.name, "trend EMAs", [tb.ema20, tb.ema50], [c.trend.ema20, c.trend.ema50]);
  const pa = priceActionBlock(bars);
  checked++;
  if (pa.today !== c.price_action.today || pa.week !== c.price_action.week)
    fail(c.name, "price_action", pa, c.price_action);

  // netBias sanity (not in golden — just must not throw)
  netBias(tb, iv);
}

console.log(`\nChecked ${checked} assertions across ${golden.length} cases.`);
if (failures === 0) {
  console.log("✅ PARITY: TS Finora engine matches the Python reference.");
  process.exit(0);
}
console.log(`❌ ${failures} mismatches.`);
process.exit(1);
