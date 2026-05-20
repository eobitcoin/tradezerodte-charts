import type { MetadataRoute } from "next";

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

/**
 * robots.txt — explicit allow list for public marketing/glossary pages,
 * deny everything authenticated. Tells Google not to even queue admin or
 * private content.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/welcome", "/learn", "/learn/*"],
        disallow: [
          "/admin",
          "/admin/*",
          "/api/",
          "/api/*",
          "/posts/*",
          "/calendar",
          "/calendar/*",
          "/maxpain",
          "/maxpain/*",
          "/polymarket",
          "/polymarket/*",
          "/insider",
          "/insider/*",
          "/research",
          "/research/*",
          "/crypto",
          "/crypto/*",
          "/radar",
          "/radar/*",
          "/profile",
          "/help",
          "/verify-email",
          "/forgot-password",
          "/reset-password",
        ],
      },
    ],
    sitemap: `${APP_URL}/sitemap.xml`,
    host: APP_URL,
  };
}
