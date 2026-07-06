import { NextResponse } from "next/server";
import { db } from "@/db";
import { leads, users } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { checkPolicy } from "@/lib/rate-limit";
import { and, desc, eq, isNull } from "drizzle-orm";
import Papa from "papaparse";

export async function GET() {
  const session = await getSession();
  if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = checkPolicy("api.authenticated", session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const rows = await db
    .select({
      name: leads.name,
      phone: leads.phone,
      email: leads.email,
      disposition: leads.disposition,
      owner: users.name,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .leftJoin(users, eq(leads.ownerId, users.id))
    .where(and(eq(leads.companyId, session.companyId), isNull(leads.deletedAt)))
    .orderBy(desc(leads.createdAt));

  const csv = Papa.unparse(
    rows.map((r) => ({
      Name: r.name || "",
      Phone: r.phone || "",
      Email: r.email || "",
      Disposition: r.disposition,
      Owner: r.owner || "Unassigned",
      "Created At": r.createdAt.toISOString(),
    }))
  );

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="leads-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
