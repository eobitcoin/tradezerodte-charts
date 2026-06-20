/**
 * /research/rotation — 308-redirect to /sector/rotation.
 *
 * The Sector Rotation surface lives under the Sector hub now, alongside
 * the live aggressor-flow Bubbles chart. This stub preserves the old
 * URL so existing bookmarks, external links, and sitemap entries keep
 * landing on the right place. The query string (?day=YYYY-MM-DD) is
 * forwarded verbatim.
 */
import { permanentRedirect } from "next/navigation";

interface PageProps {
  searchParams: Promise<{ day?: string }>;
}

export default async function RotationRedirect({ searchParams }: PageProps) {
  const { day } = await searchParams;
  const dest = day && /^\d{4}-\d{2}-\d{2}$/.test(day)
    ? `/sector/rotation?day=${day}`
    : "/sector/rotation";
  permanentRedirect(dest);
}
