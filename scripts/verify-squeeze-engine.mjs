/**
 * Parity check: TS squeeze engine vs the Python reference engine.
 *
 * Golden vectors are produced by the Python `squeeze_engine.compute()` over a
 * set of synthetic OHLC series (see the generator in the squeeze-ultra source
 * notes). This script runs the TS port over the SAME bars and asserts every
 * per-bar state / momentum / mom_color / ideal matches.
 *
 * Run:  node scripts/verify-squeeze-engine.mjs path/to/squeeze_golden.json
 * (defaults to scripts/squeeze_golden.json if no arg).
 *
 * Because the engine is plain TS with no imports, we transpile it on the fly
 * by stripping types is overkill — instead we import the compiled function via
 * a tiny inline re-implementation bridge: we read the .ts with esbuild if
 * present, else fall back to tsx/ts-node. Simplest portable path: use Node's
 * experimental strip-types (Node 22+) by importing the .ts directly.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const goldenPath = process.argv[2] || join(here, "squeeze_golden.json");

const { computeSeries } = await import(join(here, "..", "lib", "squeeze-ultra-engine.ts"));

const golden = JSON.parse(readFileSync(goldenPath, "utf8"));

const TOL = 1e-6;
let failures = 0;
let checked = 0;

for (const c of golden) {
  const bars = c.bars.map((b) => ({ o: b.o, h: b.h, l: b.l, c: b.c }));
  const got = computeSeries(bars);
  for (let i = 0; i < bars.length; i++) {
    const g = got[i];
    // state
    if ((g.state ?? null) !== (c.state[i] ?? null)) {
      console.log(`[${c.name}] bar ${i}: state TS=${g.state} PY=${c.state[i]}`);
      failures++;
    }
    // momentum (tolerance)
    const mTs = g.momentum,
      mPy = c.momentum[i];
    if (mTs == null || mPy == null) {
      if ((mTs == null) !== (mPy == null)) {
        console.log(`[${c.name}] bar ${i}: momentum null mismatch TS=${mTs} PY=${mPy}`);
        failures++;
      }
    } else if (Math.abs(mTs - mPy) > TOL) {
      console.log(`[${c.name}] bar ${i}: momentum TS=${mTs} PY=${mPy} Δ=${Math.abs(mTs - mPy)}`);
      failures++;
    }
    // mom_color
    if ((g.momColor ?? null) !== (c.mom_color[i] ?? null)) {
      console.log(`[${c.name}] bar ${i}: color TS=${g.momColor} PY=${c.mom_color[i]}`);
      failures++;
    }
    // ideal (long)
    if (Boolean(g.ideal) !== Boolean(c.ideal[i])) {
      console.log(`[${c.name}] bar ${i}: ideal TS=${g.ideal} PY=${c.ideal[i]}`);
      failures++;
    }
    // idealShort (bearish mirror)
    if (Boolean(g.idealShort) !== Boolean(c.ideal_short[i])) {
      console.log(`[${c.name}] bar ${i}: idealShort TS=${g.idealShort} PY=${c.ideal_short[i]}`);
      failures++;
    }
    checked++;
  }
}

console.log(`\nChecked ${checked} bars across ${golden.length} cases.`);
if (failures === 0) {
  console.log("✅ PARITY: TS engine matches Python reference bar-for-bar.");
  process.exit(0);
} else {
  console.log(`❌ ${failures} mismatches.`);
  process.exit(1);
}
