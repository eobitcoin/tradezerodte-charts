import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const APP_URL = process.env.APP_URL || "https://www.oliviatrades.com";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "0DTE Market Research — Invite-Only Private Research",
    template: "%s · 0DTE Market Research",
  },
  description:
    "Trader-grade daily 0DTE options research, Max Pain & gamma-exposure analytics, Polymarket whale tracking, and a regime-aware economic calendar. Invite-only.",
  keywords: [
    "0DTE options",
    "max pain",
    "gamma exposure",
    "GEX",
    "options research",
    "polymarket whales",
    "prediction markets",
    "economic calendar",
    "options trading",
  ],
  alternates: {
    canonical: APP_URL,
  },
  openGraph: {
    type: "website",
    siteName: "0DTE Market Research",
    title: "0DTE Market Research — Invite-Only Private Research",
    description:
      "Trader-grade daily 0DTE options research, Max Pain & gamma analytics, Polymarket whale tracking, and a regime-aware economic calendar. Invite-only.",
    url: APP_URL,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "0DTE Market Research",
    description:
      "Trader-grade daily 0DTE research, Max Pain & GEX analytics, Polymarket whale tracking. Invite-only.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
