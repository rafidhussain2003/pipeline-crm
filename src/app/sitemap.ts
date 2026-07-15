import type { MetadataRoute } from "next";

// Phase 14 — sitemap for the public marketing pages only (the CRM app itself is
// behind auth and must not be indexed). Served at /sitemap.xml.
const SITE_URL = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://ziplod.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const routes = [
    { path: "", priority: 1.0, changeFrequency: "weekly" as const },
    { path: "/pricing", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/contact", priority: 0.6, changeFrequency: "yearly" as const },
    { path: "/signup", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/login", priority: 0.5, changeFrequency: "yearly" as const },
    { path: "/privacy", priority: 0.3, changeFrequency: "yearly" as const },
    { path: "/terms", priority: 0.3, changeFrequency: "yearly" as const },
    { path: "/data-deletion", priority: 0.3, changeFrequency: "yearly" as const },
  ];
  return routes.map((r) => ({ url: `${SITE_URL}${r.path}`, lastModified: now, changeFrequency: r.changeFrequency, priority: r.priority }));
}
