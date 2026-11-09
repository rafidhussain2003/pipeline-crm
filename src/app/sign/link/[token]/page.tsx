import type { Metadata } from "next";
import { LinkClient } from "./LinkClient";

// PUBLIC share-link landing page — no login. The visitor enters their name
// and email and is taken to their own private signing page.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign document", robots: { index: false, follow: false } };

export default async function ShareLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <LinkClient token={token} />;
}
