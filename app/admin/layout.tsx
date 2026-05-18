import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentAdmin } from "@/lib/auth";
import SiteHeader from "@/components/SiteHeader";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    // Hard 403 via redirect to login. Non-admin authed users land back at /.
    redirect("/login?next=/admin");
  }

  return (
    <>
      <SiteHeader />
      <div className="max-w-7xl mx-auto px-4 py-6">
        <nav className="flex items-center gap-4 text-sm border-b border-black/10 dark:border-white/10 pb-3 mb-6">
          <Link href="/admin" className="font-semibold tracking-tight">
            Admin
          </Link>
          <Link href="/admin/users" className="text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white">
            Users
          </Link>
          <Link href="/admin/users?status=pending" className="text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white">
            Pending
          </Link>
          <Link href="/admin/waitlist" className="text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white">
            Waitlist
          </Link>
          <Link href="/admin/research/funds" className="text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white">
            Inst. funds
          </Link>
          <Link href="/admin/briefings" className="text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white">
            Briefings
          </Link>
          <span className="ml-auto text-xs text-black/50 dark:text-white/50">
            Signed in as <span className="font-mono">{admin.email}</span>
          </span>
        </nav>
        {children}
      </div>
    </>
  );
}
