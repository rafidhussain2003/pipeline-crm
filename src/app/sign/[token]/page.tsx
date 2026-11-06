import type { Metadata } from "next";
import { SignClient } from "./SignClient";

// PUBLIC signing page — no login. The token in the URL is the signer's
// credential; everything is loaded client-side from /api/sign/[token].
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign document", robots: { index: false, follow: false } };

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SignClient token={token} />;
}
