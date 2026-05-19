/**
 * Shared boilerplate for briefing video captions across platforms.
 *
 * The disclaimer is a legal/educational shield for trading content. It must
 * appear on every published video — pre-filled in the admin UI, AND
 * defensively appended server-side at upload time if the admin's edited
 * caption doesn't already contain it.
 *
 * Marker phrase: any caption containing "Not financial advice"
 * (case-insensitive) is treated as already disclaimed. Lets the admin
 * rephrase the disclaimer without us double-stamping it.
 */

export const DISCLAIMER_MARKER = "not financial advice";

/** Full YouTube description disclaimer — verbose, hashtag-friendly. */
export const YT_DISCLAIMER = `⚠️ DISCLAIMER

Educational content only. Not financial advice. The trade ideas discussed in this video are for informational and educational purposes only and reflect personal opinion at the time of recording. Nothing here is a recommendation to buy, sell, or hold any security or derivative.

Trading options, including 0DTE (zero days to expiration) options, involves substantial risk of loss and is not suitable for every investor. You can lose more than your initial investment. Past performance does not guarantee future results. Always do your own research and consult a licensed financial advisor before making investment decisions.`;

/** Tighter TikTok caption disclaimer — same legal intent, fewer characters. */
export const TT_DISCLAIMER = `⚠️ Educational only. Not financial advice. Options trading involves substantial risk of loss. Do your own research.`;

/**
 * Append the disclaimer to a caption iff it doesn't already contain the
 * marker phrase. Idempotent — safe to call on already-disclaimed text.
 */
export function ensureDisclaimer(
  caption: string,
  disclaimer: string,
): string {
  if (caption.toLowerCase().includes(DISCLAIMER_MARKER)) return caption;
  return `${caption.trimEnd()}\n\n${disclaimer}`;
}
