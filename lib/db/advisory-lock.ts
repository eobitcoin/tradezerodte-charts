/**
 * Postgres advisory lock helper.
 *
 * `pg_try_advisory_lock(id)` is a non-blocking session-level lock — it returns
 * true if we got the lock, false if someone else holds it. The lock is tied
 * to the connection that acquired it, not the transaction, so it survives
 * across multiple statements but vanishes when the connection is closed or
 * recycled to the pool.
 *
 * To prevent the pool's normal connection-recycling from accidentally
 * releasing the lock mid-use, we **reserve** a dedicated connection (via
 * postgres-js's `client.reserve()`) for the lifetime of the critical section.
 * All real work inside the closure can still use the shared `db` pool — the
 * lock just lives on the reserved connection.
 *
 * Use this to gate any code that must not run concurrently (the BotWick
 * monitor tick is the canonical example: two ticks racing on the same set
 * of `signal_fired` rows would double-submit to Tradier).
 */

import { client } from "@/lib/db";

export type AdvisoryLockResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: "lock_unavailable"; reason: string };

/**
 * Run `fn` while holding the advisory lock for `lockId`. If another connection
 * already holds the lock, returns `{ ok: false }` without executing `fn`.
 *
 * The lock is always released (and the reserved connection always returned to
 * the pool) — including when `fn` throws.
 */
export async function withAdvisoryLock<T>(
  lockId: number,
  fn: () => Promise<T>,
): Promise<AdvisoryLockResult<T>> {
  const reserved = await client.reserve();
  try {
    const rows = await reserved<{ acquired: boolean }[]>`SELECT pg_try_advisory_lock(${lockId}) AS acquired`;
    const acquired = rows[0]?.acquired === true;
    if (!acquired) {
      return {
        ok: false,
        code: "lock_unavailable",
        reason: `advisory lock ${lockId} held by another connection`,
      };
    }
    try {
      const data = await fn();
      return { ok: true, data };
    } finally {
      // Release the lock on the SAME connection that acquired it. Wrap in try
      // to ensure we still release the reserved connection even if unlock errors.
      try {
        await reserved`SELECT pg_advisory_unlock(${lockId})`;
      } catch {
        // best-effort; reserved.release() below will return the connection
        // and any leaked lock is bounded by the connection's lifetime.
      }
    }
  } finally {
    reserved.release();
  }
}

/** Lock IDs. Keep them stable and globally unique within this codebase. */
export const LOCK_IDS = {
  BOTWICK_MONITOR_TICK: 7770_0001,
} as const;
