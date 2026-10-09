// Billing clients — the "Bill To" party printed on invoices. Created once
// (name, address, country …), then picked from a list when recording revenue
// so every invoice for that client carries identical details.
import { db } from "@/db";
import { financeClients } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { FinanceError } from "./types";

export interface ClientInput {
  name: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state?: string | null;
  postalCode?: string | null;
  country: string;
  email?: string | null;
  phone?: string | null;
  gstin?: string | null;
  invoiceCurrency?: string | null;
  serviceDescription?: string | null;
  notes?: string | null;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const opt = (v: unknown, max: number) => str(v, max) || null;

function normalize(input: ClientInput) {
  const name = str(input.name, 200);
  const addressLine1 = str(input.addressLine1, 200);
  const city = str(input.city, 120);
  const country = str(input.country, 120);
  if (!name) throw new FinanceError("Company name is required");
  if (!addressLine1) throw new FinanceError("Address is required");
  if (!city) throw new FinanceError("City is required");
  if (!country) throw new FinanceError("Country is required");
  const currency = (str(input.invoiceCurrency, 3) || "USD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new FinanceError("Invoice currency must be a 3-letter code (e.g. USD)");
  const email = opt(input.email, 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new FinanceError("Enter a valid email address");
  return {
    name,
    addressLine1,
    addressLine2: opt(input.addressLine2, 200),
    city,
    state: opt(input.state, 120),
    postalCode: opt(input.postalCode, 32),
    country,
    email,
    phone: opt(input.phone, 60),
    gstin: opt(input.gstin, 32)?.toUpperCase() ?? null,
    invoiceCurrency: currency,
    serviceDescription: str(input.serviceDescription, 200) || "BPO Services",
    notes: opt(input.notes, 2000),
  };
}

export async function listClients(companyId: string, opts: { includeInactive?: boolean } = {}) {
  return db
    .select()
    .from(financeClients)
    .where(and(eq(financeClients.companyId, companyId), opts.includeInactive ? undefined : eq(financeClients.active, true)))
    .orderBy(asc(financeClients.name));
}

export async function getClient(companyId: string, id: string) {
  const [row] = await db.select().from(financeClients).where(and(eq(financeClients.id, id), eq(financeClients.companyId, companyId))).limit(1);
  return row ?? null;
}

export async function createClient(companyId: string, actorUserId: string, input: ClientInput) {
  const values = normalize(input);
  const [row] = await db.insert(financeClients).values({ companyId, ...values, createdBy: actorUserId }).returning();
  await recordAudit({ companyId, userId: actorUserId, action: "finance.client_created", entityType: "finance_client", entityId: row.id, after: { name: row.name, country: row.country } });
  return row;
}

export async function updateClient(companyId: string, actorUserId: string, id: string, input: ClientInput & { active?: boolean }) {
  const existing = await getClient(companyId, id);
  if (!existing) throw new FinanceError("Client not found", 404);
  const values = normalize(input);
  const [row] = await db
    .update(financeClients)
    .set({ ...values, active: typeof input.active === "boolean" ? input.active : existing.active, updatedAt: new Date() })
    .where(and(eq(financeClients.id, id), eq(financeClients.companyId, companyId)))
    .returning();
  await recordAudit({ companyId, userId: actorUserId, action: "finance.client_updated", entityType: "finance_client", entityId: id, before: { name: existing.name }, after: { name: row.name, active: row.active } });
  return row;
}

// Clients are never hard-deleted (posted revenue points at them); archiving
// just hides them from the picker.
export async function setClientActive(companyId: string, actorUserId: string, id: string, active: boolean) {
  const [row] = await db
    .update(financeClients)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(financeClients.id, id), eq(financeClients.companyId, companyId)))
    .returning();
  if (!row) throw new FinanceError("Client not found", 404);
  await recordAudit({ companyId, userId: actorUserId, action: active ? "finance.client_restored" : "finance.client_archived", entityType: "finance_client", entityId: id });
  return row;
}

// The "Bill To" lines exactly as printed on the invoice.
export function clientAddressLines(c: { addressLine1: string; addressLine2: string | null; city: string; state: string | null; postalCode: string | null; country: string }): string[] {
  const lines = [c.addressLine1];
  if (c.addressLine2) lines.push(c.addressLine2);
  const locality = [c.city, c.state, c.country].filter(Boolean).join(", ") + (c.postalCode ? ` ${c.postalCode}` : "");
  lines.push(locality);
  return lines;
}
