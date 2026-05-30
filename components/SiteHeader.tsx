import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { userProfiles } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import LogoutButton from "./LogoutButton";
import UserAvatar from "./UserAvatar";

export default async function SiteHeader() {
  const user = await getCurrentUser();
  const profile = user
    ? (await db.select().from(userProfiles).where(eq(userProfiles.userId, user.id)).limit(1))[0]
    : undefined;
  const isAdmin = user?.role === "admin";

  return (
    <header className="border-b border-black/10 dark:border-white/10">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-baseline gap-2 group"
        >
          <span className="inline-block px-3 py-1 rounded-md bg-red-600 text-white font-sans font-semibold tracking-tight ring-2 ring-red-500/25 group-hover:ring-red-500/50 shadow-sm shadow-red-900/30 transition-all">
            0DTE Market Research
          </span>
          <span className="font-sans text-[10px] uppercase tracking-[0.22em] text-black/40 dark:text-white/40 group-hover:text-black/60 dark:group-hover:text-white/60 transition-colors">
            private
          </span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/" className="hover:underline">Today</Link>
          {/* Stocks is now a hub link — landing on /research surfaces the
           *  Research|Metals|Quantum|Radar sub-nav so users can pivot
           *  between equity research surfaces without going through the
           *  top-level menu. */}
          <Link href="/research" className="hover:underline">Stocks</Link>
          {/* Top-level chip is "Options" — the surface inside is still called
           *  Options Edge in copy/headings, but this menu entry will grow to
           *  hold sibling options features (GEX dashboard, unusual flow). */}
          <Link href="/research/options-edge" className="hover:underline">Options</Link>
          <Link href="/crypto" className="hover:underline">Crypto</Link>
          <Link
            href="/botwick"
            className="px-2 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 font-mono font-semibold tracking-wider"
            title="BotWick — automated options trading bot"
          >
            BotWick
          </Link>
          <Link
            href="/morning-brief"
            className="px-2 py-0.5 rounded border border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300 hover:bg-red-500/20 font-mono font-semibold tracking-wider"
            title="Brief — Olivia's daily 20-second 0DTE recap"
          >
            Brief
          </Link>
          {isAdmin && (
            <Link
              href="/admin"
              className="px-2 py-0.5 rounded border border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300 hover:bg-violet-500/20 text-xs font-semibold"
            >
              Admin
            </Link>
          )}
          {user && (
            <Link
              href="/profile"
              className="ml-1 inline-flex"
              title={`Signed in as ${user.email} — click to edit profile`}
            >
              <UserAvatar
                email={user.email}
                fullName={profile?.fullName ?? null}
                displayName={profile?.displayName ?? null}
              />
            </Link>
          )}
          <LogoutButton />
        </nav>
      </div>
    </header>
  );
}
