import { NextResponse } from "next/server";
import { getObjectStream } from "@/lib/s3";

export const runtime = "nodejs";

/**
 * GET /api/dashboard/hero-poster
 *
 * Serves the Olivia hero image used on the logged-in dashboard's Latest
 * Video card. The bytes live in our Tigris bucket at the stable key
 * `dashboard/hero-poster.png` — pushed there by `scripts/mirror-hero-poster.mjs`.
 *
 * Cached aggressively (1 week, immutable) because the image is hand-curated;
 * swap by re-running the mirror script with a new SOURCE_URL and bumping
 * the bucket key suffix (e.g., -v2) if you need to invalidate caches
 * faster.
 */
const KEY = "dashboard/hero-poster.png";

export async function GET() {
  const obj = await getObjectStream(KEY);
  if (!obj) {
    return NextResponse.json(
      { error: "hero-poster not in bucket; run scripts/mirror-hero-poster.mjs" },
      { status: 404 },
    );
  }
  return new Response(obj.body, {
    status: 200,
    headers: {
      "Content-Type": obj.contentType ?? "image/png",
      ...(obj.contentLength != null
        ? { "Content-Length": String(obj.contentLength) }
        : {}),
      // Browser + CDN cache: 1 week, immutable. The image is overwritten
      // by the mirror script when needed — same key, so cached copies
      // can stay stale for up to a week. If you change the image and want
      // immediate effect, version the route (?v=2) or bump the bucket key.
      "Cache-Control": "public, max-age=604800, immutable",
    },
  });
}
