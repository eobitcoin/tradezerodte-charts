import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { institutionalFunds } from "@/lib/db/schema";
import FundsAdminClient from "@/components/FundsAdminClient";

export const dynamic = "force-dynamic";

export default async function FundsAdminPage() {
  const funds = await db
    .select()
    .from(institutionalFunds)
    .orderBy(asc(institutionalFunds.sortOrder), asc(institutionalFunds.name));
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Institutional fund watchlist</h1>
        <p className="text-sm text-black/60 dark:text-white/60 max-w-prose">
          Funds the weekly <strong>Institutional Flow</strong> scan pulls 13F filings for.
          Disabled funds are skipped on the next run. CIKs are 10-digit SEC identifiers
          (with leading zeros). Find them via{" "}
          <a
            href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=13F-HR&dateb=&owner=include&count=40"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            SEC EDGAR
          </a>
          .
        </p>
      </header>
      <FundsAdminClient initialFunds={funds} />
    </div>
  );
}
