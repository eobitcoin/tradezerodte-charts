"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { UserRole, UserStatus } from "@/lib/db/schema";

type AccessChoice = "default" | "none" | "custom";

export default function AdminUserActions({
  userId,
  email,
  emailVerified,
  status,
  role,
  selfId,
  defaultAccessIso,
  currentExpiry,
}: {
  userId: string;
  /** Target user's email — required for the delete-confirmation gate */
  email: string;
  /** Whether the user has verified their email yet (for the manual-override panel) */
  emailVerified: boolean;
  status: UserStatus;
  role: UserRole;
  selfId: string;
  /** ISO string of "1 year from now" — generated server-side and passed in */
  defaultAccessIso: string;
  /** Existing expiry, if any, ISO */
  currentExpiry: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Approval / extend dialog state
  const [accessChoice, setAccessChoice] = useState<AccessChoice>("default");
  const [customDate, setCustomDate] = useState<string>(
    currentExpiry ? currentExpiry.slice(0, 10) : defaultAccessIso.slice(0, 10),
  );

  const isSelf = userId === selfId;

  function resolveExpiryPayload(): string | null | "default" {
    if (accessChoice === "default") return "default";
    if (accessChoice === "none") return null;
    // custom — the date input is YYYY-MM-DD; treat it as midnight UTC end-of-day
    const d = new Date(`${customDate}T23:59:59Z`);
    return d.toISOString();
  }

  async function call(path: string, body?: unknown, method: "POST" | "DELETE" = "POST"): Promise<void> {
    setError(null);
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `${res.status} ${res.statusText}`);
    }
  }

  function handle(promise: () => Promise<void>) {
    startTransition(() => {
      promise()
        .then(() => router.refresh())
        .catch((e) => setError(String(e.message ?? e)));
    });
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Manual email verification — only shows when the user hasn't verified
          (e.g. Yahoo PH01 bounced their verification email). Sits at the top
          since it's the prerequisite to approval. */}
      {!emailVerified && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.07] p-4 space-y-2">
          <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-300">
            Email not verified
          </h3>
          <p className="text-xs text-black/65 dark:text-white/65 leading-relaxed">
            This user hasn&apos;t clicked their verification link. Common causes: provider
            bounced the email (Yahoo / iCloud / corporate filters often reject one-time
            verification links from new domains), email landed in spam, or they just
            haven&apos;t gotten to it. Use this only when you&apos;ve confirmed the email is
            real out-of-band — clicking it bypasses the proof-of-control check.
          </p>
          <button
            disabled={pending}
            onClick={() =>
              handle(() => call(`/api/admin/users/${userId}/verify-email`))
            }
            className="px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold disabled:opacity-50"
          >
            Mark email verified manually
          </button>
        </div>
      )}

      {/* Approve / Extend access (with expiry chooser) */}
      <div className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">
            {status === "pending" ? "Approve access" : "Extend / change access expiry"}
          </h3>
        </div>
        <fieldset className="space-y-1.5 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="acc"
              checked={accessChoice === "default"}
              onChange={() => setAccessChoice("default")}
            />
            <span>1 year from today (default)</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="acc"
              checked={accessChoice === "none"}
              onChange={() => setAccessChoice("none")}
            />
            <span>No expiry</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="acc"
              checked={accessChoice === "custom"}
              onChange={() => setAccessChoice("custom")}
            />
            <span>Custom date:</span>
            <input
              type="date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              onClick={() => setAccessChoice("custom")}
              className="rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-0.5 text-sm font-mono"
            />
          </label>
        </fieldset>
        <div className="flex gap-2">
          {status === "pending" && (
            <button
              disabled={pending}
              onClick={() =>
                handle(() =>
                  call(`/api/admin/users/${userId}/approve`, {
                    accessExpiresAt: resolveExpiryPayload(),
                  }),
                )
              }
              className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50"
            >
              Approve
            </button>
          )}
          {status === "active" && (
            <button
              disabled={pending}
              onClick={() =>
                handle(() => {
                  const payload = resolveExpiryPayload();
                  // /extend doesn't accept "default" — resolve here to a real ISO.
                  const accessExpiresAt =
                    payload === "default"
                      ? new Date(
                          new Date().setFullYear(new Date().getFullYear() + 1),
                        ).toISOString()
                      : payload;
                  return call(`/api/admin/users/${userId}/extend`, {
                    accessExpiresAt,
                  });
                })
              }
              className="px-3 py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold disabled:opacity-50"
            >
              Update expiry
            </button>
          )}
        </div>
      </div>

      {/* Disable / Enable */}
      <div className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-3">
        {status === "disabled" ? (
          <>
            <h3 className="text-sm font-semibold">Re-enable user</h3>
            <p className="text-xs text-black/55 dark:text-white/55">
              Restores status to active. Existing expiry is preserved.
            </p>
            <button
              disabled={pending || isSelf}
              onClick={() => handle(() => call(`/api/admin/users/${userId}/enable`))}
              className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50"
            >
              Re-enable
            </button>
          </>
        ) : (
          <DisableForm
            userId={userId}
            disabled={pending || isSelf}
            isSelf={isSelf}
            onCall={(reason) =>
              handle(() => call(`/api/admin/users/${userId}/disable`, { reason }))
            }
          />
        )}
      </div>

      {/* Role */}
      <div className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-3">
        <h3 className="text-sm font-semibold">Role</h3>
        <p className="text-xs text-black/55 dark:text-white/55">
          Admins can manage other users. You can&apos;t change your own role.
        </p>
        <div className="flex gap-2">
          <button
            disabled={pending || isSelf || role === "admin"}
            onClick={() =>
              handle(() => call(`/api/admin/users/${userId}/role`, { role: "admin" }))
            }
            className="px-3 py-1.5 rounded border border-violet-500/40 bg-violet-500/10 hover:bg-violet-500/20 text-violet-700 dark:text-violet-300 text-sm font-semibold disabled:opacity-30"
          >
            Promote to admin
          </button>
          <button
            disabled={pending || isSelf || role === "user"}
            onClick={() =>
              handle(() => call(`/api/admin/users/${userId}/role`, { role: "user" }))
            }
            className="px-3 py-1.5 rounded border border-black/15 dark:border-white/15 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] text-sm font-semibold disabled:opacity-30"
          >
            Demote to user
          </button>
        </div>
      </div>

      {/* Delete (destructive, last) */}
      <DeleteSection
        userId={userId}
        email={email}
        role={role}
        disabled={pending}
        isSelf={isSelf}
        onSuccess={() => router.push("/admin/users")}
        onCall={(confirm) =>
          startTransition(() => {
            (async () => {
              try {
                await call(`/api/admin/users/${userId}`, { confirm }, "DELETE");
                router.push("/admin/users");
              } catch (e) {
                setError(String((e as Error).message ?? e));
              }
            })();
          })
        }
      />
    </div>
  );
}

function DeleteSection({
  email,
  role,
  disabled,
  isSelf,
  onCall,
}: {
  userId: string;
  email: string;
  role: UserRole;
  disabled: boolean;
  isSelf: boolean;
  onSuccess: () => void;
  onCall: (confirm: string) => void;
}) {
  const [armed, setArmed] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const blocked = isSelf || role === "admin";
  const confirmMatches = confirmText.toLowerCase().trim() === email.toLowerCase();

  return (
    <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 space-y-3">
      <h3 className="text-sm font-semibold text-rose-700 dark:text-rose-300">
        Delete account
      </h3>
      <p className="text-xs text-black/65 dark:text-white/65 leading-relaxed">
        Permanently removes this user record, their sessions, profile, and audit
        history. <strong>Irreversible.</strong> Prefer <em>Disable</em> if there&apos;s
        any chance of restoring access later.
      </p>
      {blocked && (
        <p className="text-[11px] text-rose-600 dark:text-rose-400">
          {isSelf
            ? "You can't delete yourself."
            : "Demote this admin to user before deleting."}
        </p>
      )}
      {!armed ? (
        <button
          disabled={disabled || blocked}
          onClick={() => setArmed(true)}
          className="px-3 py-1.5 rounded border border-rose-500/50 bg-rose-500/10 text-rose-700 dark:text-rose-300 hover:bg-rose-500/20 text-sm font-semibold disabled:opacity-30"
        >
          Delete account…
        </button>
      ) : (
        <div className="space-y-2">
          <label className="block text-xs text-black/65 dark:text-white/65">
            Type{" "}
            <span className="font-mono text-rose-700 dark:text-rose-300">{email}</span>{" "}
            to confirm:
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={email}
            className="w-full rounded border border-rose-500/40 bg-transparent px-2.5 py-1.5 text-sm font-mono"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              disabled={disabled || !confirmMatches}
              onClick={() => onCall(email)}
              className="px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Permanently delete
            </button>
            <button
              disabled={disabled}
              onClick={() => {
                setArmed(false);
                setConfirmText("");
              }}
              className="px-3 py-1.5 rounded border border-black/15 dark:border-white/15 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DisableForm({
  disabled,
  isSelf,
  onCall,
}: {
  userId: string;
  disabled: boolean;
  isSelf: boolean;
  onCall: (reason: string | undefined) => void;
}) {
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <h3 className="text-sm font-semibold">Disable user</h3>
      <p className="text-xs text-black/55 dark:text-white/55">
        Immediately revokes all sessions and blocks future logins. The user is emailed.
      </p>
      <input
        type="text"
        placeholder="Reason (optional, sent to user)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="w-full rounded border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm"
      />
      {!confirm ? (
        <button
          disabled={disabled || isSelf}
          onClick={() => setConfirm(true)}
          className="px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold disabled:opacity-50"
        >
          Disable
        </button>
      ) : (
        <div className="flex gap-2">
          <button
            disabled={disabled}
            onClick={() => onCall(reason || undefined)}
            className="px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold"
          >
            Confirm disable
          </button>
          <button
            disabled={disabled}
            onClick={() => setConfirm(false)}
            className="px-3 py-1.5 rounded border border-black/15 dark:border-white/15 text-sm"
          >
            Cancel
          </button>
        </div>
      )}
      {isSelf && (
        <p className="text-[11px] text-rose-600 dark:text-rose-400">
          You can&apos;t disable yourself.
        </p>
      )}
    </>
  );
}
