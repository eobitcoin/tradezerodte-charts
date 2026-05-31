import { timingSafeEqual } from "node:crypto";

export type BearerCheckResult =
  | { ok: true }
  | { ok: false; status: number; reason: string };

/**
 * Generic bearer-token check against an env-var-stored secret. Used by both
 * the ingest endpoint and the BotWick cron endpoint, with different vars so
 * the blast radius of a leaked token is bounded by what its endpoint can do.
 */
function checkBearerAgainst(envVar: string, req: Request): BearerCheckResult {
  const expected = process.env[envVar];
  if (!expected) return { ok: false, status: 500, reason: `${envVar} not configured` };

  const cookie = req.headers.get("cookie") || "";
  if (cookie.includes("session=")) {
    return { ok: false, status: 403, reason: "session cookie not permitted" };
  }
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) {
    return { ok: false, status: 401, reason: "missing bearer token" };
  }
  const presented = auth.slice("Bearer ".length).trim();
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, reason: "invalid bearer token" };
  }
  return { ok: true };
}

/**
 * BotWick cron token. Separate from INGEST_API_KEY so a leaked ingest key
 * cannot trigger trading orders. Set as `BOTWICK_CRON_TOKEN` in Railway env.
 */
export function requireBotwickCronBearer(req: Request): BearerCheckResult {
  return checkBearerAgainst("BOTWICK_CRON_TOKEN", req);
}

/**
 * IV-snapshot cron token. Used by the daily Polygon IV surface harvester that
 * feeds the Options Edge weekly scanner. Separate from BotWick so a leaked
 * trading token cannot trigger snapshot writes (and vice versa). Set as
 * `IV_SNAPSHOT_CRON_TOKEN` in Railway env.
 */
export function requireIvSnapshotCronBearer(req: Request): BearerCheckResult {
  return checkBearerAgainst("IV_SNAPSHOT_CRON_TOKEN", req);
}

/**
 * UOA scanner cron token. Separate from the IV snapshot token so a leaked
 * token can only fire UOA scans (not write IV snapshots, not trigger trades).
 * Set as `UOA_CRON_TOKEN` in Railway env. The daily EOD cron AND the
 * intraday 5-min cron share this token.
 */
export function requireUoaCronBearer(req: Request): BearerCheckResult {
  return checkBearerAgainst("UOA_CRON_TOKEN", req);
}

/**
 * GEX snapshot cron token. Used by the 5-minute Dealer Gamma
 * Exposure refresher. Separate from UOA so a leak is bounded. Set as
 * `GEX_CRON_TOKEN` in Railway env.
 */
export function requireGexCronBearer(req: Request): BearerCheckResult {
  return checkBearerAgainst("GEX_CRON_TOKEN", req);
}

export function requireIngestBearer(req: Request): BearerCheckResult {
  const expected = process.env.INGEST_API_KEY;
  if (!expected) return { ok: false, status: 500, reason: "INGEST_API_KEY not configured" };

  // CSRF concern: the original guard rejected requests carrying Cookie or Origin headers
  // (assumption: browsers always send those; scripts never do). That's wrong — many script
  // runtimes (including curl behind some proxies, the CCR sandbox, fetch in serverless
  // workers) send an Origin header. The Bearer token alone is sufficient: it's held only
  // by trusted scripts, not by browsers. We still reject any request that carries a
  // session Cookie matching our session cookie name (defense against accidentally
  // forwarding a logged-in user's session).
  const cookie = req.headers.get("cookie") || "";
  if (cookie.includes("session=")) {
    return { ok: false, status: 403, reason: "session cookie not permitted on ingest" };
  }

  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) {
    return { ok: false, status: 401, reason: "missing bearer token" };
  }
  const presented = auth.slice("Bearer ".length).trim();
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, reason: "invalid bearer token" };
  }
  return { ok: true };
}
