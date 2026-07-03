import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ user: null });

  let company = null;
  if (session.companyId) {
    const [c] = await db.select().from(companies).where(eq(companies.id, session.companyId)).limit(1);
    company = c || null;
  }

  return NextResponse.json({ user: session, company });
}
