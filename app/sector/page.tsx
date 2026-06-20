import SiteHeader from "@/components/SiteHeader";
import SectorBubbles from "@/components/SectorBubbles";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sector Flow — 0DTE Research",
  description:
    "Real-time aggressor flow across sector ETFs, indices, and the Mag 7 — bubble size is net buy/sell volume, color is % change.",
};

export default function SectorPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 space-y-4">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Sector Flow</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            Real-time aggressor flow across 11 sector ETFs, 4 index ETFs, and the
            Mag 7. Bubble size is <span className="font-mono">|buy − sell volume|</span>{" "}
            classified from NBBO; color is price change over the selected timeframe.
            Updates every 2 min during market hours.
          </p>
        </header>

        <SectorBubbles />

        <section className="text-xs text-black/50 dark:text-white/50 pt-2 border-t border-black/10 dark:border-white/10 space-y-1">
          <p>
            <strong>How to read it:</strong> a fat green bubble means heavy net buying
            and a green tape; a fat red bubble means heavy net selling and a red tape;
            a green bubble that&apos;s small means the buying skew is light. Grey =
            no flow yet in the window (off-hours or pre-cron).
          </p>
          <p>
            <strong>Aggressor classification:</strong> a print lifting the ask counts
            as a buy; hitting the bid counts as a sell; midmarket prints are
            unclassified and excluded from net flow. Same rule used by{" "}
            <a className="underline" href="/research/unusual-activity">
              Unusual Activity
            </a>{" "}
            on the options side.
          </p>
        </section>
      </main>
    </>
  );
}
