import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import Sidebar from "@/components/Sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  let companyName = "Super Admin";
  if (session.companyId) {
    const [company] = await db.select().from(companies).where(eq(companies.id, session.companyId)).limit(1);
    companyName = company?.name || "";
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar companyName={companyName} role={session.role} />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
