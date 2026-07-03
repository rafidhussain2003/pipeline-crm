import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pipeline — Fast lead management for Facebook lead ads",
  description: "A fast, simple CRM built for high-volume lead capture, tiered auto-assignment, and multi-company scale.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
