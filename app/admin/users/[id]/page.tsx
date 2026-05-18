import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, userProfiles, adminActions, type UserStatus, type UserRole } from "@/lib/db/schema";
import { getCurrentAdmin } from "@/lib/auth";
import AdminUserActions from "@/components/AdminUserActions";
import AdminProfileEditor from "@/components/AdminProfileEditor";
import { defaultAccessExpiry } from "@/lib/admin";

export const dynamic = "force-dynamic";

function statusPill(status: UserStatus): string {
  switch (status) {
    case "pending":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40";
    case "active":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40";
    case "disabled":
      return "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40";
  }
  return "";
}

function rolePill(role: UserRole): string {
  return role === "admin"
    ? "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/40"
    : "bg-black/5 dark:bg-white/10 text-black/55 dark:text-white/55 border-black/10 dark:border-white/10";
}

function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = (await getCurrentAdmin())!; // layout already redirected if not admin
  const { id } = await params;

  const row = (
    await db
      .select({
        user: users,
        profile: userProfiles,
      })
      .from(users)
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .where(eq(users.id, id))
      .limit(1)
  )[0];
  if (!row) notFound();

  const u = row.user;
  const profile = row.profile;

  const actions = await db
    .select({
      id: adminActions.id,
      action: adminActions.action,
      createdAt: adminActions.createdAt,
      actorEmail: sql<string>`(select email from users where id = ${adminActions.actorUserId})`,
      note: adminActions.note,
      before: adminActions.beforeValue,
      after: adminActions.afterValue,
    })
    .from(adminActions)
    .where(eq(adminActions.targetUserId, id))
    .orderBy(desc(adminActions.createdAt))
    .limit(50);

  const defaultAccessIso = defaultAccessExpiry().toISOString();
  const currentExpiryIso = u.accessExpiresAt ? u.accessExpiresAt.toISOString() : null;

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin/users"
          className="text-sm text-black/55 dark:text-white/55 hover:underline"
        >
          ← Back to users
        </Link>
      </div>

      <header className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-bold tracking-tight font-mono">{u.email}</h1>
        <span className={`inline-block px-2 py-0.5 text-[10px] font-semibold rounded border ${statusPill(u.status)}`}>
          {u.status}
        </span>
        <span className={`inline-block px-2 py-0.5 text-[10px] font-semibold rounded border ${rolePill(u.role)}`}>
          {u.role}
        </span>
        {!u.emailVerified && (
          <span className="inline-block px-2 py-0.5 text-[10px] font-semibold rounded border bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/40">
            email unverified
          </span>
        )}
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: facts + actions */}
        <div className="space-y-6">
          <section className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-2 text-sm">
            <h2 className="text-xs uppercase tracking-[0.18em] text-black/55 dark:text-white/55 mb-2">
              Account
            </h2>
            <Row label="User ID" value={<span className="font-mono text-xs">{u.id}</span>} />
            <Row label="Created" value={fmtDateTime(u.createdAt)} />
            <Row label="Email verified" value={u.emailVerified ? "yes" : "no"} />
            <Row label="Approved at" value={fmtDateTime(u.approvedAt)} />
            <Row
              label="Access expires"
              value={
                u.accessExpiresAt
                  ? fmtDateTime(u.accessExpiresAt)
                  : u.status === "active"
                    ? "no expiry"
                    : "—"
              }
            />
            {u.status === "disabled" && (
              <>
                <Row label="Disabled at" value={fmtDateTime(u.disabledAt)} />
                <Row label="Disabled reason" value={u.disabledReason || "—"} />
              </>
            )}
            <Row label="Subscription tier" value={u.subscriptionTier} />
          </section>

          <AdminUserActions
            userId={u.id}
            email={u.email}
            emailVerified={u.emailVerified}
            status={u.status}
            role={u.role}
            selfId={admin.id}
            defaultAccessIso={defaultAccessIso}
            currentExpiry={currentExpiryIso}
          />
        </div>

        {/* Right: profile editor + audit log */}
        <div className="space-y-6">
          <section className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-3">
            <h2 className="text-xs uppercase tracking-[0.18em] text-black/55 dark:text-white/55">
              Profile
            </h2>
            <AdminProfileEditor
              userId={u.id}
              displayName={profile?.displayName ?? null}
              fullName={profile?.fullName ?? null}
              timezone={profile?.timezone ?? null}
              adminNotes={profile?.adminNotes ?? null}
            />
          </section>

          <section className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-3">
            <h2 className="text-xs uppercase tracking-[0.18em] text-black/55 dark:text-white/55">
              Audit log
            </h2>
            {actions.length === 0 ? (
              <p className="text-sm text-black/50 dark:text-white/50 italic">No actions recorded.</p>
            ) : (
              <ul className="space-y-2">
                {actions.map((a) => (
                  <li
                    key={a.id}
                    className="border-l-2 border-black/15 dark:border-white/15 pl-3 py-1 text-xs"
                  >
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-mono font-semibold">{a.action}</span>
                      <span className="text-black/50 dark:text-white/50">by</span>
                      <span className="font-mono">{a.actorEmail}</span>
                      <span className="text-black/40 dark:text-white/40 ml-auto">
                        {fmtDateTime(a.createdAt)}
                      </span>
                    </div>
                    {a.note && (
                      <div className="text-black/65 dark:text-white/65 italic mt-0.5">
                        &quot;{a.note}&quot;
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-xs text-black/55 dark:text-white/55 w-32 shrink-0">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}
