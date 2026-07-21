import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSession, type CompanySession } from "@/lib/auth";
import { isUuid } from "@/lib/url";
import { and, eq, isNull } from "drizzle-orm";
import { MODULES, getEffectiveModuleAccess, setModuleAccess } from "@/lib/module-access";
import type { Role } from "@/lib/permissions";
import { checkPolicy } from "@/lib/rate-limit";

// Enterprise Workspaces — a user's module assignment. ADMIN ONLY (the spec:
// "the Admin must be able to … assign exactly which modules they can
// access"); managers manage agents but not the module map.
async function requireAdmin() {
  const session = await getSession();
  if (!session || !session.companyId || session.role !== "admin") {
    return { ok: false as const, response: NextResponse.json({ error: "Only a company admin can manage module access." }, { status: 403 }) };
  }
  return { ok: true as const, session: session as CompanySession };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [target] = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(eq(users.id, id), eq(users.companyId, auth.session.companyId), isNull(users.deletedAt)))
    .limit(1);
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const effective = await getEffectiveModuleAccess(target.id, target.role as Role);
  return NextResponse.json({ catalog: MODULES, effective, targetRole: target.role });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rl = checkPolicy("api.admin", auth.session.userId);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  if (!body?.modules || typeof body.modules !== "object") {
    return NextResponse.json({ error: "modules must be an object of { module: boolean }" }, { status: 400 });
  }

  try {
    const effective = await setModuleAccess(auth.session.companyId, auth.session.userId, id, body.modules as Record<string, boolean>);
    return NextResponse.json({ effective });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not update module access" }, { status: 400 });
  }
}
