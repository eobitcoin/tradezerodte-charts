import Link from "next/link";
import { eq, ilike, desc, and, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, userProfiles, type UserRole, type UserStatus } from "@/lib/db/schema";

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
  return "bg-black/5 dark:bg-white/10 text-black/55 dark:text-white/55 border-black/10 dark:border-white/10";
}

function rolePill(role: UserRole): string {
  return role === "admin"
    ? "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/40"
    : "bg-black/5 dark:bg-white/10 text-black/55 dark:text-white/55 border-black/10 dark:border-white/10";
}

function fmtExpiry(d: Date | null, status: UserStatus): { text: string; cls: string } {
  if (status !== "active") return { text: "—", cls: "text-black/40 dark:text-white/40" };
  if (!d) return { text: "no expiry", cls: "text-black/55 dark:text-white/55" };
  const now = Date.now();
  const t = d.getTime();
  const days = Math.floor((t - now) / (24 * 3600 * 1000));
  if (days < 0)
    return { text: `expired ${-days}d ago`, cls: "text-rose-600 dark:text-rose-400 font-semibold" };
  if (days <= 30)
    return {
      text: `${d.toISOString().slice(0, 10)} (${days}d)`,
      cls: "text-amber-600 dark:text-amber-400 font-semibold",
    };
  return {
    text: `${d.toISOString().slice(0, 10)} (${days}d)`,
    cls: "text-black/65 dark:text-white/65",
  };
}

function FilterChip({
  label,
  active,
  href,
}: {
  label: string;
  active: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
        active
          ? "bg-black text-white dark:bg-white dark:text-black border-black dark:border-white"
          : "bg-transparent border-black/15 dark:border-white/15 text-black/65 dark:text-white/65 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
      }`}
    >
      {label}
    </Link>
  );
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; role?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const conds = [];
  if (sp.status === "pending" || sp.status === "active" || sp.status === "disabled") {
    conds.push(eq(users.status, sp.status));
  }
  if (sp.role === "admin" || sp.role === "user") {
    conds.push(eq(users.role, sp.role));
  }
  if (sp.q && sp.q.trim()) {
    conds.push(ilike(users.email, `%${sp.q.trim()}%`));
  }

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      status: users.status,
      emailVerified: users.emailVerified,
      accessExpiresAt: users.accessExpiresAt,
      createdAt: users.createdAt,
      displayName: userProfiles.displayName,
    })
    .from(users)
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(conds.length ? and(...conds) : sql`true`)
    .orderBy(desc(users.createdAt));

  const buildHref = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { ...sp, ...overrides };
    for (const [k, v] of Object.entries(merged)) {
      if (v) params.set(k, v);
    }
    const s = params.toString();
    return `/admin/users${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Users</h1>
        <span className="text-xs text-black/55 dark:text-white/55 font-mono">
          {rows.length} result{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-[10px] uppercase tracking-[0.18em] text-black/50 dark:text-white/50 mr-1">
          Status
        </span>
        <FilterChip label="all" active={!sp.status} href={buildHref({ status: undefined })} />
        <FilterChip label="pending" active={sp.status === "pending"} href={buildHref({ status: "pending" })} />
        <FilterChip label="active" active={sp.status === "active"} href={buildHref({ status: "active" })} />
        <FilterChip label="disabled" active={sp.status === "disabled"} href={buildHref({ status: "disabled" })} />
        <span className="mx-2 text-black/20 dark:text-white/20">|</span>
        <span className="text-[10px] uppercase tracking-[0.18em] text-black/50 dark:text-white/50 mr-1">
          Role
        </span>
        <FilterChip label="all" active={!sp.role} href={buildHref({ role: undefined })} />
        <FilterChip label="admin" active={sp.role === "admin"} href={buildHref({ role: "admin" })} />
        <FilterChip label="user" active={sp.role === "user"} href={buildHref({ role: "user" })} />
      </div>

      {/* Search */}
      <form action="/admin/users" method="get" className="flex gap-2">
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search by email…"
          className="flex-1 max-w-sm rounded border border-black/10 dark:border-white/15 bg-transparent px-3 py-1.5 text-sm"
        />
        {sp.status && <input type="hidden" name="status" value={sp.status} />}
        {sp.role && <input type="hidden" name="role" value={sp.role} />}
        <button type="submit" className="text-sm px-3 py-1.5 rounded border border-black/15 dark:border-white/15 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]">
          Search
        </button>
        {(sp.q || sp.status || sp.role) && (
          <Link
            href="/admin/users"
            className="text-sm px-3 py-1.5 rounded border border-black/15 dark:border-white/15 text-black/55 dark:text-white/55 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
          >
            Clear
          </Link>
        )}
      </form>

      {/* Table */}
      {rows.length === 0 ? (
        <div className="rounded border border-black/10 dark:border-white/10 p-6 text-sm text-black/60 dark:text-white/60 text-center">
          No users match these filters.
        </div>
      ) : (
        <div className="overflow-x-auto border border-black/10 dark:border-white/10 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-black/[0.03] dark:bg-white/[0.03]">
              <tr className="text-left">
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Display name</th>
                <th className="px-3 py-2 w-24">Role</th>
                <th className="px-3 py-2 w-24">Status</th>
                <th className="px-3 py-2">Access until</th>
                <th className="px-3 py-2 w-32">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const exp = fmtExpiry(u.accessExpiresAt, u.status);
                return (
                  <tr
                    key={u.id}
                    className="border-t border-black/10 dark:border-white/10 align-top hover:bg-black/[0.02] dark:hover:bg-white/[0.04]"
                  >
                    <td className="px-3 py-2">
                      <Link
                        href={`/admin/users/${u.id}`}
                        className="font-mono text-xs hover:underline"
                      >
                        {u.email}
                      </Link>
                      {!u.emailVerified && (
                        <span className="ml-2 inline-block px-1.5 py-0.5 text-[9px] font-semibold rounded border bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/40">
                          UNVERIFIED
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-black/70 dark:text-white/70">
                      {u.displayName || "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 text-[10px] font-semibold rounded border ${rolePill(u.role)}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 text-[10px] font-semibold rounded border ${statusPill(u.status)}`}>
                        {u.status}
                      </span>
                    </td>
                    <td className={`px-3 py-2 font-mono text-xs ${exp.cls}`}>{exp.text}</td>
                    <td className="px-3 py-2 font-mono text-xs text-black/55 dark:text-white/55">
                      {u.createdAt.toISOString().slice(0, 10)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
