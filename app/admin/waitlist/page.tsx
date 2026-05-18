import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { waitlistSignups, type WaitlistStatus } from "@/lib/db/schema";
import { defaultAccessExpiry } from "@/lib/admin";
import WaitlistInviteActions from "@/components/WaitlistInviteActions";

export const dynamic = "force-dynamic";

function statusPill(status: WaitlistStatus): string {
  if (status === "pending")
    return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40";
  if (status === "invited")
    return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40";
  return "bg-black/5 dark:bg-white/10 text-black/55 dark:text-white/55 border-black/10 dark:border-white/10";
}

function fmtDateTime(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default async function AdminWaitlistPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const filter =
    sp.status === "pending" || sp.status === "invited" || sp.status === "declined"
      ? (sp.status as WaitlistStatus)
      : null;

  let rows = await db
    .select()
    .from(waitlistSignups)
    .orderBy(desc(waitlistSignups.createdAt))
    .limit(500);

  if (filter) rows = rows.filter((r) => r.status === filter);

  const pending = rows.filter((r) => r.status === "pending").length;
  const invited = rows.filter((r) => r.status === "invited").length;
  const total = rows.length;
  const defaultIso = defaultAccessExpiry().toISOString();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Waitlist</h1>
        <p className="text-sm text-black/55 dark:text-white/55 mt-1">
          People who applied through the public landing page at <code>/welcome</code>.
        </p>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-[10px] uppercase tracking-[0.18em] text-black/50 dark:text-white/50 mr-1">
          Status
        </span>
        {[
          { label: "all", value: undefined, n: total },
          { label: "pending", value: "pending" as const, n: pending },
          { label: "invited", value: "invited" as const, n: invited },
        ].map((c) => {
          const href = c.value ? `/admin/waitlist?status=${c.value}` : "/admin/waitlist";
          const active = filter === c.value;
          return (
            <Link
              key={c.label}
              href={href}
              className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                active
                  ? "bg-black text-white dark:bg-white dark:text-black border-black dark:border-white"
                  : "bg-transparent border-black/15 dark:border-white/15 text-black/65 dark:text-white/65 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
              }`}
            >
              {c.label} {c.n > 0 && <span className="ml-1 opacity-60">{c.n}</span>}
            </Link>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <div className="rounded border border-black/10 dark:border-white/10 p-6 text-sm text-black/60 dark:text-white/60 text-center">
          No waitlist applications {filter ? `with status "${filter}"` : "yet"}.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div
              key={r.id}
              className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-3"
            >
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-semibold">{r.fullName}</span>
                    <span className="font-mono text-xs text-black/55 dark:text-white/55">
                      {r.email}
                    </span>
                    <span
                      className={`inline-block px-2 py-0.5 text-[10px] font-semibold rounded border ${statusPill(r.status)}`}
                    >
                      {r.status}
                    </span>
                  </div>
                  <div className="text-[11px] text-black/55 dark:text-white/55 font-mono mt-0.5">
                    Applied: {fmtDateTime(r.createdAt)}
                    {r.invitedAt && ` · Invited: ${fmtDateTime(r.invitedAt)}`}
                  </div>
                </div>
                {r.status === "pending" && (
                  <WaitlistInviteActions
                    waitlistId={r.id}
                    email={r.email}
                    defaultAccessIso={defaultIso}
                  />
                )}
                {r.status === "invited" && r.userId && (
                  <Link
                    href={`/admin/users/${r.userId}`}
                    className="text-xs px-2 py-0.5 rounded border border-black/15 dark:border-white/15 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                  >
                    View user →
                  </Link>
                )}
              </div>
              <div className="grid sm:grid-cols-[140px_minmax(0,1fr)] gap-y-2 gap-x-3 text-sm">
                <div className="text-xs text-black/55 dark:text-white/55 uppercase tracking-wider pt-0.5">Experience</div>
                <div>{r.tradingExperience}</div>
                <div className="text-xs text-black/55 dark:text-white/55 uppercase tracking-wider pt-0.5">Why interested</div>
                <div className="text-black/80 dark:text-white/80 whitespace-pre-wrap">{r.whyInterested}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
