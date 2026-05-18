#!/usr/bin/env node
/**
 * Convert a 0DTE Trading Research routine output (.docx or .md) into the
 * /api/posts JSON shape. Optionally POST it to the app.
 *
 * Usage:
 *   INGEST_API_KEY=... APP_URL=https://your.app \
 *     tsx scripts/ingest-routine.ts \
 *       --input ~/path/to/report.md \
 *       --post
 */

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { parseTradesFromMarkdown, inferTitle } from "../lib/parse-routine";

interface CliArgs {
  input?: string;
  out?: string;
  post?: boolean;
  dry?: boolean;
  debug?: boolean;
  appUrl?: string;
  apiKey?: string;
  tradingDay?: string;
  title?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--post") out.post = true;
    else if (a === "--dry") out.dry = true;
    else if (a === "--debug") out.debug = true;
    else if (a === "--input") out.input = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--app-url") out.appUrl = argv[++i];
    else if (a === "--api-key") out.apiKey = argv[++i];
    else if (a === "--trading-day") out.tradingDay = argv[++i];
    else if (a === "--title") out.title = argv[++i];
  }
  return out;
}

function todayNyDate(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

async function docxToMd(docxPath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const proc = spawn("pandoc", [docxPath, "-t", "markdown", "--wrap=none"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", (e) => reject(e));
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(`pandoc exited ${code}: ${err}`));
      else resolve(out);
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbg = args.debug ? (m: string) => process.stderr.write(`[debug] ${m}\n`) : () => {};

  if (!args.input) {
    console.error(
      "Usage: ingest-routine --input <path.docx|.md> [--post] [--out json] [--trading-day YYYY-MM-DD]\n" +
        "Also: --app-url, --api-key, --title, --dry, --debug",
    );
    process.exit(1);
  }
  const stat = await fs.stat(args.input).catch(() => null);
  if (!stat || !stat.isFile()) {
    console.error(`Input file not found: ${args.input}`);
    process.exit(1);
  }

  const ext = path.extname(args.input).toLowerCase();
  let md: string;
  if (ext === ".docx") {
    dbg("converting .docx -> markdown via pandoc");
    md = await docxToMd(args.input);
  } else if (ext === ".md" || ext === ".markdown" || ext === ".txt") {
    md = await fs.readFile(args.input, "utf8");
  } else {
    console.error(`Unsupported extension: ${ext} (expected .docx or .md)`);
    process.exit(1);
  }

  const trades = parseTradesFromMarkdown(md);
  dbg(`Parsed ${trades.length} trades`);
  if (args.debug) {
    for (const t of trades) {
      dbg(`  ${t.ticker.padEnd(6)} ${t.grade} ${t.direction ?? "?"}`);
    }
  }

  const tradingDay = args.tradingDay ?? todayNyDate();
  const payload = {
    title: args.title ?? inferTitle(md) ?? `0DTE Options Analysis — ${tradingDay}`,
    trading_day: tradingDay,
    run_at: new Date().toISOString(),
    trades,
    body_md: md,
    meta: {
      source: "ingest-routine.ts",
      input_file: path.basename(args.input),
      ingested_at: new Date().toISOString(),
    },
  };

  const json = JSON.stringify(payload, null, 2);

  if (args.out) {
    await fs.writeFile(args.out, json);
    process.stderr.write(`Wrote ${args.out} (${trades.length} trades)\n`);
  }

  if (args.post || args.dry) {
    const appUrl = (
      args.appUrl ?? process.env.APP_URL ?? "https://web-production-92205.up.railway.app"
    ).replace(/\/$/, "");
    const apiKey = args.apiKey ?? process.env.INGEST_API_KEY;
    if (!apiKey) {
      console.error("Missing API key. Set INGEST_API_KEY env var or pass --api-key.");
      process.exit(1);
    }
    const target = `${appUrl}/api/posts`;
    if (args.dry) {
      process.stderr.write(`[dry] would POST ${json.length} bytes to ${target}\n`);
      if (!args.out) process.stdout.write(json);
      return;
    }
    process.stderr.write(`POST ${target} (${trades.length} trades, ${json.length} bytes)\n`);
    const res = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: json,
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`POST failed: HTTP ${res.status}\n${text}`);
      process.exit(1);
    }
    process.stderr.write(`HTTP ${res.status} -> ${text}\n`);
    return;
  }

  if (!args.out) process.stdout.write(json);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
