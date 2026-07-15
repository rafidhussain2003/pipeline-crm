import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Phase 14 — optimized web font (self-hosted by next/font, no layout shift,
// no external request) applied app-wide for a consistent, modern look.
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

const SITE_URL = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://ziplod.com";
const TITLE = "Ziplod — AI CRM for Lead Generation Teams";
const DESCRIPTION = "Connect Meta Lead Ads in minutes. Ziplod's AI automatically assigns leads to available agents — no spreadsheets, no manual routing. 7-day free trial, no credit card required.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s — Ziplod" },
  description: DESCRIPTION,
  applicationName: "Ziplod",
  keywords: ["CRM", "lead management", "Meta Lead Ads", "Facebook Lead Ads", "AI lead assignment", "lead routing", "sales CRM"],
  authors: [{ name: "Breetscan CableTV LLC" }],
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Ziplod",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  robots: { index: true, follow: true },
  alternates: { canonical: SITE_URL },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`h-full antialiased ${inter.className}`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
