import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { acknowledgeCallback, CallbackError } from "@/lib/callbacks";

// Dismiss the on-screen reminder. The callback stays open — this only stops the
// banner from re-appearing on the next page load.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    await acknowledgeCallback(session, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof CallbackError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
