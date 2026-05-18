import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { userProfiles } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import SiteHeader from "@/components/SiteHeader";
import ProfileEditor from "@/components/ProfileEditor";

export const dynamic = "force-dynamic";

function fmt(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "long",
    timeStyle: "short",
  });
}

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/profile");

  const profile = (
    await db.select().from(userProfiles).where(eq(userProfiles.userId, user.id)).limit(1)
  )[0];

  return (
    <>
      <SiteHeader />
      <main className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">My profile</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            Edit how your name appears across the site, and view your account status.
          </p>
        </header>

        {/* Account status (read-only) */}
        <section className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-2 text-sm">
          <h2 className="text-xs uppercase tracking-[0.18em] text-black/55 dark:text-white/55 mb-2">
            Account status
          </h2>
          <Row label="Email" value={<span className="font-mono text-xs">{user.email}</span>} />
          <Row
            label="Status"
            value={
              <span className="inline-block px-2 py-0.5 text-[10px] font-semibold rounded border bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40">
                {user.status}
              </span>
            }
          />
          <Row
            label="Role"
            value={
              <span
                className={`inline-block px-2 py-0.5 text-[10px] font-semibold rounded border ${
                  user.role === "admin"
                    ? "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/40"
                    : "bg-black/5 dark:bg-white/10 text-black/55 dark:text-white/55 border-black/10 dark:border-white/10"
                }`}
              >
                {user.role}
              </span>
            }
          />
          <Row
            label="Access until"
            value={user.accessExpiresAt ? fmt(user.accessExpiresAt) : "no expiry"}
          />
          <Row label="Member since" value={fmt(user.createdAt)} />
        </section>

        <section className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-3">
          <h2 className="text-xs uppercase tracking-[0.18em] text-black/55 dark:text-white/55">
            Edit profile
          </h2>
          <ProfileEditor
            displayName={profile?.displayName ?? null}
            fullName={profile?.fullName ?? null}
            timezone={profile?.timezone ?? null}
          />
        </section>
      </main>
    </>
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
