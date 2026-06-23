# Daily Briefing — Setting Prompt Rotation

## Why this exists

Free-form setting_prompt generation by the script-writer routine kept
drifting — most recently producing "espresso on the desk" + Higgsfield Soul
defaulting to also putting one in her hand, producing double-cup scenes.

The fix: a locked 10-prompt rotation. The daily script-writer routine should
call the MCP tool `pick_daily_briefing_setting_prompt`, get one verbatim,
and pass it straight through to `publish_briefing_script`. No improvisation.

## How the rotation is picked

`pick_daily_briefing_setting_prompt` is deterministic per trading day:
`index = (day-of-year) % 10`. Same day → same prompt every call. No DB
state needed. Re-runs idempotent.

If you want to force a specific one for a re-render, pass `index: N` to the
tool explicitly (0-indexed).

## The 10 prompts (verbatim)

| # | Prompt | Has beverage? |
|---|--------|---------------|
| 0 | Sun-drenched home office, small espresso cup held up near her shoulder, NO cup on the desk, crisp white linen shirt, confident upright posture, easy morning energy, soft smile | Espresso (hand) |
| 1 | Bright morning home office, hands resting on the desk gesturing as she speaks, NO coffee cup in the frame, white linen shirt with sleeves rolled, confident posture, warm professional energy | None |
| 2 | Cozy kitchen corner at sunrise, mug of tea on the counter beside her, hands free and gesturing, soft cream sweater, easy confident smile, warm morning glow | Tea (counter) |
| 3 | Modern home office with floor-to-ceiling windows, leaning slightly forward in her chair, hands clasped on the desk, NO beverage in shot, structured white blouse, polished morning energy | None |
| 4 | Sunlit kitchen island, glass of water in hand, white linen shirt, easy confident posture, soft morning light from the side, warm friendly smile | Water (hand) |
| 5 | Home office at golden hour, sketchpad and pen in front of her on the desk, hands gesturing as she speaks, NO cup anywhere, navy cashmere crewneck, focused upbeat energy | None |
| 6 | Bright breakfast nook, half-eaten croissant on a small plate beside her, hands free and animated, oversized white button-up, easy magnetic smile, casual Monday energy | None (food only) |
| 7 | Cozy home library corner, hardcover book closed on the desk, hands gesturing as she speaks, NO mug or cup visible, soft beige turtleneck, confident posture, warm intellectual energy | None |
| 8 | Sunny home office, small cappuccino in hand held near her chin between sentences, NO additional cups on the desk, crisp white shirt, easy confident smile, bright morning vibe | Cappuccino (hand) |
| 9 | Minimalist home office at sunrise, laptop open in front of her, hands resting on the keyboard then gesturing, NO drinkware in frame, fitted white tee under an open blazer, polished upbeat morning energy | None |

**Beverage balance:** 4 of 10 have a beverage, 6 are bev-free. Roughly
matches "she shouldn't always have coffee" guidance.

## Critical constraints (baked into every prompt)

- Each prompt is EXPLICIT about cup placement (`NO cup on the desk`,
  `NO beverage in the frame`, `held up near her chin`, etc).
- When a cup is present, it's in one place — hand OR surface — never both.
- The negative-instruction wording overrides Soul's default coffee-add tendency.

## How the daily script-writer routine should use it

Replace the existing "pick a setting_prompt" step with:

> **STEP — Get the setting_prompt.** Call MCP tool
> `pick_daily_briefing_setting_prompt` with `{ trading_day: <today NY date> }`.
> Use the returned `prompt` verbatim — do NOT modify, merge, or improvise.

That's it. The rotation is locked at the MCP layer, so future routine
edits can't accidentally regress to free-form composition.
