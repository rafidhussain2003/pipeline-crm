import { NextRequest, NextResponse } from "next/server";
import { requireFinance, financeErrorResponse } from "@/lib/finance/guard";
import { ensureFinanceSetup, FinanceError } from "@/lib/finance";
import { db } from "@/db";
import { financeSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";

export async function GET() {
  const auth = await requireFinance("finance:view");
  if (!auth.ok) return auth.response;
  await ensureFinanceSetup(auth.session.companyId);
  const [settings] = await db.select().from(financeSettings).where(eq(financeSettings.companyId, auth.session.companyId)).limit(1);
  return NextResponse.json({ settings });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireFinance("finance:manage");
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  try {
    const currency = typeof body?.defaultCurrency === "string" ? body.defaultCurrency.trim().toUpperCase() : null;
    if (!currency || !/^[A-Z]{3}$/.test(currency)) throw new FinanceError("Currency must be a 3-letter code (e.g. USD)");
    const [settings] = await db
      .update(financeSettings)
      .set({ defaultCurrency: currency, updatedAt: new Date() })
      .where(eq(financeSettings.companyId, auth.session.companyId))
      .returning();
    await recordAudit({ companyId: auth.session.companyId, userId: auth.session.userId, action: "finance.settings_updated", entityType: "finance_settings", entityId: auth.session.companyId, after: { defaultCurrency: currency } });
    return NextResponse.json({ settings });
  } catch (err) {
    return financeErrorResponse(err);
  }
}
