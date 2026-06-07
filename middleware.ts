import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-constant";

const PUBLIC_PATHS = new Set([
  "/login",
  "/signup",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
  "/welcome",
  "/explore",
  "/learn",
  "/help",
  "/morning-brief",
  "/tickers",
  "/privacy",
  "/terms",
  // Public "about" page — used as the OAuth Application home page URL
  // for Google's verification (reviewers need a public landing page
  // that explains the brand + purpose of the app without an auth
  // wall in the way).
  "/about",
  "/robots.txt",
  "/sitemap.xml",
  // Google Search Console site-verification token. Must be reachable
  // unauthenticated so Google's crawler can fetch it.
  "/googlec0640cbf8a1a59b7.html",
  // TikTok Developer Portal URL-prefix verification. Must be reachable
  // unauthenticated so TikTok's verifier can fetch the signature file.
  // Multiple tokens kept since each Dev Portal app restart issues a
  // new one; harmless to keep around.
  "/tiktok1AxeWfeC2bcjMMFzq8BfQ2HoyBfSJkpQ.txt",
  "/tiktok3X8MMqR3myQm4PedkEImyxThRCkfYvil.txt",
  "/tiktokE2TBjUCqXfjIUmUc5HHvvhFTRA9Ps7Lu.txt",
]);

/** Public route prefixes — any path starting with these is unauthenticated.
 *  /learn/    — long-form SEO explainers
 *  /explore/  — public teaser pages with server-side-trimmed previews of
 *               authenticated research. Hidden fields are stripped at the
 *               DB-query layer, never sent to the client.
 *  /tickers/  — per-ticker hub pages (free briefs + locked research teasers).
 *               Members-only content links from here go through the existing
 *               /explore/ paywall, not bypassed by the public hub. */
const PUBLIC_PREFIXES = ["/learn/", "/explore/", "/morning-brief/", "/tickers/"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/assets/")
  ) {
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }
  for (const prefix of PUBLIC_PREFIXES) {
    if (pathname.startsWith(prefix)) {
      return NextResponse.next();
    }
  }
  // Public waitlist signup endpoint.
  if (pathname === "/api/waitlist/join") {
    return NextResponse.next();
  }

  const session = req.cookies.get(SESSION_COOKIE)?.value;
  if (!session) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
