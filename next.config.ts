import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Permanent redirect from the apex domain to the canonical www
  // host, preserving the full path + query string. The apex domain
  // (oliviatrades.com) is added as a second custom domain in Railway
  // so it can hit the app at all; without this redirect it would
  // serve content on two URLs, splitting SEO equity.
  //
  // GoDaddy's URL forwarding (which previously handled the apex)
  // only redirected `/`, so subpaths like /privacy and /terms 404'd.
  // This replaces that with a real Next.js redirect that covers
  // every path — important for Google OAuth verification, which
  // reviews the exact privacy/terms URLs we submit.
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "oliviatrades.com" }],
        destination: "https://www.oliviatrades.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
