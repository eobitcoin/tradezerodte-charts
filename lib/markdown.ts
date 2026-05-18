import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSanitize from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeHighlight from "rehype-highlight";
import rehypeStringify from "rehype-stringify";
import { tickerAnchor } from "./grade";

export async function renderMarkdown(md: string, tickers: string[] = []): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSanitize)
    .use(rehypeSlug)
    .use(rehypeHighlight, { detect: true })
    .use(rehypeStringify)
    .process(md);

  let html = String(file);

  // For each known ticker, inject a stable id="ticker-XYZ" on the FIRST h2/h3 whose
  // text starts with that ticker (case-insensitive). The trade summary chips link here.
  for (const t of tickers) {
    const upper = t.toUpperCase();
    const id = tickerAnchor(upper);
    if (html.includes(`id="${id}"`)) continue;
    const re = new RegExp(
      `<h([23])([^>]*)>(\\s*(?:<[^>]+>)?\\s*${escapeRe(upper)}\\b)`,
      "i",
    );
    html = html.replace(re, (_match, level, attrs, head) => {
      const cleaned = attrs.replace(/\s*id="[^"]*"/i, "");
      return `<h${level}${cleaned} id="${id}">${head}`;
    });
  }

  // The 0DTE routine emits "0DTE Trade Plan" as bold text (**...**) inside a
  // paragraph rather than a real <h4>. Tag that paragraph so .dte-post CSS can
  // paint the pure-yellow highlighter behind the text. We accept any of:
  //   **0DTE Trade Plan**
  //   **Trade Plan**          (market_open Sonnet sometimes drops the prefix)
  //   **Trade Plan:**         (with trailing colon)
  // Case-insensitive, leading/trailing whitespace tolerated. Always normalize
  // the visible heading to "0DTE Trade Plan" so the styling looks consistent.
  html = html.replace(
    /<p>\s*<strong>\s*(?:0DTE\s+)?Trade Plan\s*:?\s*<\/strong>\s*<\/p>/gi,
    '<p class="trade-plan-heading"><strong>0DTE Trade Plan</strong></p>',
  );

  // "Entry Trigger" labels — the premarket routine emits these as inline bold
  // at the start of a paragraph (e.g. "**Entry Trigger:** SPX > 5180 with ...").
  // Wrap just the label in a span so .dte-post CSS can paint a yellow
  // highlighter behind the words "Entry Trigger" without disturbing the rest
  // of the sentence. Matches market_open's existing highlighter treatment.
  html = html.replace(
    /<p>(\s*)<strong>\s*Entry Trigger\s*:?\s*<\/strong>/gi,
    '<p$1><strong class="entry-trigger-label">Entry Trigger</strong>',
  );

  return html;
}

function escapeRe(s: string): string {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}
