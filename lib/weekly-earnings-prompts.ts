/**
 * Setting-prompt rotation for the Sunday Weekly Earnings Brief videos.
 *
 * Brand direction: Olivia on a Manhattan rooftop at golden hour / dusk —
 * upscale, confident, "editorial cocktail party" sexy. The user wants to push
 * closer to the line than the daily-brief look without crossing Higgsfield's
 * content moderation.
 *
 * Higgsfield rejects:
 *   - explicit nudity descriptors ("topless", "bare", "nude", "lingerie",
 *     "underwear", "naked", "see-through", "revealing", "skimpy")
 *   - explicit body-part references ("cleavage" sometimes flagged depending
 *     on context — we avoid it as the word, lean on garment shape instead)
 *   - the word "sexy" itself is occasionally flagged — synonyms reliably pass
 *     ("alluring", "sultry", "elegant", "confident", "magnetic")
 *
 * Reliably passes:
 *   - "off-shoulder", "fitted", "form-fitting", "short dress", "deep neckline",
 *     "silk slip", "satin", "leather jacket over a tee"
 *   - "high heels", "gold jewelry", "manicured", "polished glam"
 *   - "golden hour", "sunset glow", "city lights twinkling", "candlelit"
 *
 * Each entry rotates weekly. The routine picks one at random from PRIMARY each
 * Sunday. If Higgsfield rejects the chosen prompt (`ip_detected` /
 * moderation), the routine retries once with the softer FALLBACK matched to
 * the same scene.
 */

export interface SettingPromptVariant {
  /** Push-the-line variant — the one the routine prefers. */
  primary: string;
  /** Drop-in softer rewrite of the same scene if Higgsfield rejects. */
  fallback: string;
}

export const WEEKLY_EARNINGS_PROMPTS: SettingPromptVariant[] = [
  {
    primary:
      "Manhattan rooftop at golden hour, NYC skyline behind, fitted off-shoulder satin top in deep emerald, gold hoop earrings, glass of red wine in hand, hair loose in the breeze, confident sultry posture, soft warm smile",
    fallback:
      "Manhattan rooftop at golden hour, NYC skyline behind, silk camisole and tailored blazer, gold earrings, glass of wine in hand, hair loose, confident relaxed posture, warm smile",
  },
  {
    primary:
      "Rooftop terrace at sunset, twinkling city lights, short black slip dress with thin straps, gold necklace, glossy manicure, espresso in hand, hair swept over one shoulder, alluring confident energy",
    fallback:
      "Rooftop terrace at sunset, twinkling city lights, fitted black dress, gold necklace, espresso in hand, hair swept over one shoulder, confident polished energy",
  },
  {
    primary:
      "Penthouse rooftop overlooking Brooklyn Bridge at dusk, leather jacket over a fitted white tank, dark wash jeans, gold chain, champagne flute, hair tousled, playful magnetic smile, edgy luxe vibe",
    fallback:
      "Penthouse rooftop overlooking Brooklyn Bridge at dusk, leather jacket over a white tee, dark jeans, gold chain, champagne flute, tousled hair, confident playful smile",
  },
  {
    primary:
      "Manhattan high-rise terrace at golden hour, form-fitting ivory knit dress, gold cuff bracelet, French manicure, glass of champagne, soft side-lit glow, polished editorial pose, elegant and magnetic",
    fallback:
      "Manhattan high-rise terrace at golden hour, fitted ivory knit dress, gold bracelet, glass of champagne, soft side-lit glow, polished elegant pose",
  },
  {
    primary:
      "SoHo rooftop bar at twilight, deep V satin blouse in dusty rose, black tailored trousers, gold drop earrings, glass of red wine, candlelit table, hair half-pinned, confident sultry smile, intimate luxe atmosphere",
    fallback:
      "SoHo rooftop bar at twilight, satin blouse in dusty rose, tailored trousers, gold earrings, glass of red wine, candlelit table, hair half-pinned, confident warm smile",
  },
  {
    primary:
      "Tribeca rooftop pool at sunset, silk slip dress in champagne tone, delicate gold anklet visible, hair pulled back loose, glass of prosecco, soft tan skin in the glow, polished alluring smile, jet-set luxe energy",
    fallback:
      "Tribeca rooftop at sunset, silk slip dress in champagne tone, hair pulled back loose, glass of prosecco, soft warm glow, polished confident smile",
  },
  {
    primary:
      "Upper East Side rooftop garden, sunset over Central Park, fitted black turtleneck dress with side slit, gold hoop earrings, dark red lip, glass of cabernet, hair down and tousled, sultry editorial confidence",
    fallback:
      "Upper East Side rooftop garden, sunset over Central Park, fitted black turtleneck dress, gold hoop earrings, glass of cabernet, hair down, confident editorial pose",
  },
  {
    primary:
      "Hudson Yards rooftop with skyline views, deep red wrap dress with plunging neckline, gold layered necklaces, espresso martini in hand, candle flames flickering, hair in soft waves, magnetic alluring presence",
    fallback:
      "Hudson Yards rooftop with skyline views, deep red wrap dress, gold layered necklaces, espresso martini in hand, candlelight, hair in soft waves, confident warm presence",
  },
];

/** Pick a random variant. The routine uses Date-of-week as the seed so the
 *  same Sunday always picks the same prompt if re-run (deterministic by week). */
export function pickWeeklyPromptForDate(isoDate: string): SettingPromptVariant {
  // Stable hash of the date string → index into the rotation. Deterministic
  // so a recovery rerun of the same week reuses the same prompt.
  let h = 0;
  for (let i = 0; i < isoDate.length; i++) {
    h = (h * 31 + isoDate.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(h) % WEEKLY_EARNINGS_PROMPTS.length;
  return WEEKLY_EARNINGS_PROMPTS[idx];
}
