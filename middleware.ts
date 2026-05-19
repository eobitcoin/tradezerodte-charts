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
  "/privacy",
  "/terms",
  "/robots.txt",
  "/sitemap.xml",
  // Google Search Console site-verification token. Must be reachable
  // unauthenticated so Google's crawler can fetch it.
  "/googlec0640cbf8a1a59b7.html",
]);

/** Public route prefixes — any path starting with these is unauthenticated.
 *  /learn/   — long-form SEO explainers
 *  /explore/ — public teaser pages with server-side-trimmed previews of
 *              authenticated research. Hidden fields are stripped at the
 *              DB-query layer, never sent to the client. */
const PUBLIC_PREFIXES = ["/learn/", "/explore/", "/morning-brief/"];

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
