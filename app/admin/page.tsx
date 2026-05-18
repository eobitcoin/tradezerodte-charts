import Link from "next/link";
import { sql, desc, eq, lt, and, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, adminActions } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

function Tile({
  label,
  value,
  href,
  tone = "default",
}: {
  label: string;
  value: number | string;
  href?: string;
  tone?: "default" | "warn" | "ok" | "danger";
}) {
  const toneCls =
    tone === "warn"
      ? "border-amber-500/30 bg-amber-500/5"
      : tone === "ok"
        ? "border-emerald-500/30 bg-emerald-500/5"
        : tone === "danger"
          ? "border-rose-500/30 bg-rose-500/5"
          : "border-black/10 dark:border-white/10";
  const inner = (
    <div className={`rounded-lg border ${toneCls} p-4`}>
      <div className="text-[10px] uppercase tracking-[0.18em] text-black/55 dark:text-white/55">
        {label}
      </div>
      <div className="text-3xl font-semibold tracking-tight font-mono mt-1">{value}</div>
    </div>
  );
  return href ? (
    <Link href={href} className="block hover:scale-[1.01] transition-transform">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export default async function AdminDashboardPage() {
  const now = new Date();
  const in30days = new Date(now.getTime() + 30 * 24 * 3600 * 1000);

  const [pendingRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.status, "pending"));
  const [activeRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.status, "active"));
  const [disabledRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.status, "disabled"));
  const [expiringRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(
      and(
        eq(users.status, "active"),
        isNotNull(users.accessExpiresAt),
        lt(users.accessExpiresAt, in30days),
      ),
    );

  const recentActions = await db
    .select({
      id: adminActions.id,
      action: adminActions.action,
      createdAt: adminActions.createdAt,
      actorEmail: sql<string>`(select email from users where id = ${adminActions.actorUserId})`,
      targetEmail: sql<string>`(select email from users where id = ${adminActions.targetUserId})`,
      note: adminActions.note,
    })
    .from(adminActions)
    .orderBy(desc(adminActions.createdAt))
    .limit(15);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold tracking-tight">User administration</h1>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile
          label="Pending approval"
          value={pendingRow.n}
          href="/admin/users?status=pending"
          tone={pendingRow.n > 0 ? "warn" : "default"}
        />
        <Tile
          label="Active"
          value={activeRow.n}
          href="/admin/users?status=active"
          tone="ok"
        />
        <Tile
          label="Disabled"
          value={disabledRow.n}
          href="/admin/users?status=disabled"
          tone={disabledRow.n > 0 ? "danger" : "default"}
        />
        <Tile
          label="Expiring < 30 days"
          value={expiringRow.n}
          href="/admin/users?status=active"
          tone={expiringRow.n > 0 ? "warn" : "default"}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-black/60 dark:text-white/60">
          Recent admin actions
        </h2>
        {recentActions.length === 0 ? (
          <div className="text-sm text-black/50 dark:text-white/50 italic">
            No admin actions recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto border border-black/10 dark:border-white/10 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-black/[0.03] dark:bg-white/[0.03]">
                <tr className="text-left">
                  <th className="px-3 py-2 w-40">When</th>
                  <th className="px-3 py-2 w-32">Action</th>
                  <th className="px-3 py-2">Actor</th>
                  <th className="px-3 py-2">Target</th>
                  <th className="px-3 py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {recentActions.map((a) => (
                  <tr
                    key={a.id}
                    className="border-t border-black/10 dark:border-white/10 align-top"
                  >
                    <td className="px-3 py-2 font-mono text-xs text-black/55 dark:text-white/55">
                      {a.createdAt.toLocaleString("en-US", {
                        timeZone: "America/New_York",
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{a.action}</td>
                    <td className="px-3 py-2 font-mono text-xs">{a.actorEmail}</td>
                    <td className="px-3 py-2 font-mono text-xs">{a.targetEmail}</td>
                    <td className="px-3 py-2 text-xs text-black/65 dark:text-white/65">
                      {a.note || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
