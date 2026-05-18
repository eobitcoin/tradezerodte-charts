import Image from "next/image";
import Link from "next/link";
import { renderMarkdown } from "@/lib/markdown";
import type { ResearchImage } from "@/lib/db/schema";

// Slot ordering — weekly first, daily second, anything else after that.
const SLOT_ORDER: Record<string, number> = { weekly: 0, daily: 1, intraday: 2 };

function sortImages(images: ResearchImage[]): ResearchImage[] {
  return [...images].sort((a, b) => {
    const ai = SLOT_ORDER[a.slot] ?? 99;
    const bi = SLOT_ORDER[b.slot] ?? 99;
    if (ai !== bi) return ai - bi;
    return a.slot.localeCompare(b.slot);
  });
}

function slotLabel(slot: string): string {
  if (slot === "weekly") return "Weekly chart";
  if (slot === "daily") return "Daily chart";
  if (slot === "intraday") return "Intraday chart";
  return slot.charAt(0).toUpperCase() + slot.slice(1) + " chart";
}

/**
 * Structural prop type — both ResearchPost (equity Wicked) and
 * CryptoWeeklyResearchPost satisfy this. Lets the same component render
 * both without a discriminator.
 */
export interface RenderableResearchPost {
  ticker: string;
  scanDay: string;
  title: string;
  headline: string;
  bodyMd: string;
  images: ResearchImage[];
  runAt: Date | null;
}

export default async function ResearchView({ post }: { post: RenderableResearchPost }) {
  const images = sortImages((post.images || []) as ResearchImage[]);
  const html = await renderMarkdown(post.bodyMd, []);

  return (
    <article className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <header className="space-y-2">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div className="text-xs uppercase tracking-wide text-black/50 dark:text-white/50">
            <span className="font-mono font-semibold text-black/70 dark:text-white/70">
              {post.ticker}
            </span>
            {" · "}
            Scan day · {post.scanDay}
            {post.runAt && (
              <>
                {" · Run at "}
                {new Date(post.runAt).toLocaleString("en-US", {
                  timeZone: "America/New_York",
                  dateStyle: "short",
                  timeStyle: "short",
                })}
                {" ET"}
              </>
            )}
          </div>
          <Link
            href="/learn/weekly-research"
            className="text-xs text-black/55 dark:text-white/55 hover:text-black dark:hover:text-white hover:underline"
          >
            Help · how to read this →
          </Link>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{post.title}</h1>
        {post.headline && (
          <p className="text-base text-black/70 dark:text-white/70 leading-snug">
            {post.headline}
          </p>
        )}
      </header>

      <section
        className="prose prose-neutral dark:prose-invert max-w-none"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {images.length > 0 && (
        <section className="space-y-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
            Charts
          </h2>
          <div className="grid grid-cols-1 gap-6">
            {images.map((img) => (
              <figure
                key={img.key}
                className="space-y-2 rounded-lg border border-black/10 dark:border-white/10 overflow-hidden"
              >
                <div className="bg-black/[0.02] dark:bg-white/[0.02] flex items-center justify-center">
                  {img.width && img.height ? (
                    <Image
                      src={img.url}
                      alt={img.alt || slotLabel(img.slot)}
                      width={img.width}
                      height={img.height}
                      className="w-full h-auto"
                      unoptimized
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={img.url}
                      alt={img.alt || slotLabel(img.slot)}
                      className="w-full h-auto"
                    />
                  )}
                </div>
                <figcaption className="px-3 pb-3 text-xs text-black/60 dark:text-white/60">
                  <span className="font-semibold uppercase tracking-wide">
                    {slotLabel(img.slot)}
                  </span>
                  {img.alt && <span> — {img.alt}</span>}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
