import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { db } from "@/db";
import { sales, salesReminders, users } from "@/db/schema";
import { and, asc, desc, eq, gte, isNull, lt, lte } from "drizzle-orm";
import { featureService } from "@/lib/features";
import { REMINDER_COPY, type ReminderKind } from "@/lib/sales/reminders";
import { ReminderActions } from "./ReminderActions";

// Daily dashboard — the first thing agents see after login. Today's & upcoming
// installations, and the reminder calls that are due. Everything is indexed
// (installation_at / reminder due_at) and scoped: an agent sees only their own;
// admins/managers see the whole company plus a completion history.
export const dynamic = "force-dynamic";

type SaleRow = {
  id: string;
  customerName: string | null;
  phone: string | null;
  product: string | null;
  installationDate: string | null;
  agentName: string | null;
};

export default async function HomePage() {
  const session = await getSession();
  if (!session || !session.companyId) redirect("/login");
  const viewAll = session.role === "admin" || session.role === "manager";
  // The dashboard is a Sales-Ledger surface. A company without the module keeps
  // its existing landing (/leads) — no behavior change for them.
  if (!(await featureService.isEnabled(session.companyId, "sales_ledger"))) redirect("/leads");

  const today0 = new Date();
  today0.setHours(0, 0, 0, 0);
  const tomorrow0 = new Date(today0);
  tomorrow0.setDate(tomorrow0.getDate() + 1);
  const in8 = new Date(today0);
  in8.setDate(in8.getDate() + 8); // "upcoming" = the next 7 days after today
  const now = new Date();

  const companyId = session.companyId;
  const mineSales = viewAll ? [] : [eq(sales.agentId, session.userId)];
  const mineRem = viewAll ? [] : [eq(salesReminders.agentId, session.userId)];

  const installCols = {
    id: sales.id,
    customerName: sales.customerName,
    phone: sales.phone,
    product: sales.product,
    installationDate: sales.installationDate,
    agentName: users.name,
  };

  const [todays, upcoming, pending, history] = await Promise.all([
        db
          .select(installCols)
          .from(sales)
          .leftJoin(users, eq(users.id, sales.agentId))
          .where(and(eq(sales.companyId, companyId), isNull(sales.deletedAt), gte(sales.installationAt, today0), lt(sales.installationAt, tomorrow0), ...mineSales))
          .orderBy(asc(sales.installationAt))
          .limit(100),
        db
          .select(installCols)
          .from(sales)
          .leftJoin(users, eq(users.id, sales.agentId))
          .where(and(eq(sales.companyId, companyId), isNull(sales.deletedAt), gte(sales.installationAt, tomorrow0), lt(sales.installationAt, in8), ...mineSales))
          .orderBy(asc(sales.installationAt))
          .limit(100),
        db
          .select({
            id: salesReminders.id,
            kind: salesReminders.kind,
            customerName: sales.customerName,
            phone: sales.phone,
            installationDate: sales.installationDate,
            agentName: users.name,
          })
          .from(salesReminders)
          .innerJoin(sales, eq(sales.id, salesReminders.saleId))
          .leftJoin(users, eq(users.id, salesReminders.agentId))
          .where(and(eq(salesReminders.companyId, companyId), eq(salesReminders.status, "pending"), lte(salesReminders.dueAt, now), ...mineRem))
          .orderBy(asc(salesReminders.dueAt))
          .limit(50),
        viewAll
          ? db
              .select({
                id: salesReminders.id,
                kind: salesReminders.kind,
                customerName: sales.customerName,
                completedAt: salesReminders.completedAt,
                completedByName: users.name,
              })
              .from(salesReminders)
              .innerJoin(sales, eq(sales.id, salesReminders.saleId))
              .leftJoin(users, eq(users.id, salesReminders.completedBy))
              .where(and(eq(salesReminders.companyId, companyId), eq(salesReminders.status, "completed")))
              .orderBy(desc(salesReminders.completedAt))
              .limit(20)
          : Promise.resolve([] as { id: string; kind: string; customerName: string | null; completedAt: Date | null; completedByName: string | null }[]),
      ]);

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-xl font-semibold text-slate-900">Today</h1>
      <p className="text-sm text-slate-500 mt-0.5 mb-6">
        {viewAll ? "Your company's installations and reminder calls." : "Your installations and reminder calls."}
      </p>

      <div className="space-y-6">
          {/* Pending reminder calls — the action items. */}
          <Section title="Pending Reminder Calls" count={pending.length} accent="amber">
            {pending.length === 0 ? (
              <Empty>No reminder calls due right now. 🎉</Empty>
            ) : (
              <ul className="divide-y divide-slate-100">
                {pending.map((r) => {
                  const copy = REMINDER_COPY[r.kind as ReminderKind];
                  return (
                    <li key={r.id} className="flex items-center justify-between gap-4 py-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-800">
                          {r.customerName || "Customer"}
                          {r.phone && <span className="text-slate-400 font-normal"> · {r.phone}</span>}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {copy?.body || "Installation reminder."}
                          {r.installationDate && <span className="text-slate-400"> · Installation: {r.installationDate}</span>}
                          {viewAll && r.agentName && <span className="text-slate-400"> · {r.agentName}</span>}
                        </div>
                      </div>
                      <ReminderActions id={r.id} />
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <div className="grid md:grid-cols-2 gap-6">
            <Section title="Today's Installations" count={todays.length} accent="emerald">
              <InstallList rows={todays} viewAll={viewAll} emptyText="No installations scheduled for today." />
            </Section>
            <Section title="Upcoming Installations" count={upcoming.length} accent="blue" subtitle="Next 7 days">
              <InstallList rows={upcoming} viewAll={viewAll} emptyText="Nothing scheduled in the next 7 days." />
            </Section>
          </div>

          {viewAll && (
            <Section title="Recent Reminder Completions" count={history.length} accent="slate">
              {history.length === 0 ? (
                <Empty>No reminders completed yet.</Empty>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {history.map((h) => (
                    <li key={h.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                      <span className="text-slate-700">{h.customerName || "Customer"}</span>
                      <span className="text-xs text-slate-400">
                        {h.completedByName || "—"} · {h.completedAt ? new Date(h.completedAt).toLocaleString() : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}
        </div>
    </div>
  );
}

function Section({
  title,
  count,
  accent,
  subtitle,
  children,
}: {
  title: string;
  count: number;
  accent: "amber" | "emerald" | "blue" | "slate";
  subtitle?: string;
  children: React.ReactNode;
}) {
  const tone: Record<string, string> = {
    amber: "text-amber-800 bg-amber-100",
    emerald: "text-emerald-800 bg-emerald-100",
    blue: "text-blue-800 bg-blue-100",
    slate: "text-slate-700 bg-slate-100",
  };
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        <span className={`text-xs font-bold rounded-full px-2 py-0.5 ${tone[accent]}`}>{count}</span>
        {subtitle && <span className="text-xs text-slate-400 ml-auto">{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

function InstallList({ rows, viewAll, emptyText }: { rows: SaleRow[]; viewAll: boolean; emptyText: string }) {
  if (rows.length === 0) return <Empty>{emptyText}</Empty>;
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((r) => (
        <li key={r.id}>
          <Link href="/sales" className="flex items-center justify-between gap-3 py-2.5 -mx-1 px-1 rounded hover:bg-slate-50">
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-800 truncate">{r.customerName || "Customer"}</div>
              <div className="text-xs text-slate-500 truncate">
                {r.product || "—"}
                {r.phone && <span className="text-slate-400"> · {r.phone}</span>}
                {viewAll && r.agentName && <span className="text-slate-400"> · {r.agentName}</span>}
              </div>
            </div>
            <span className="text-xs text-slate-500 shrink-0">{r.installationDate || ""}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-slate-400 py-2">{children}</div>;
}
