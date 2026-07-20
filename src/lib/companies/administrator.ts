import { db } from "@/db";
import { users } from "@/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";

// The "company administrator" = the owner by the app's existing convention:
// the earliest-created active admin (same derivation the Agents module uses
// for its computed "owner" label). Used by the Agent Portal's approval
// workflow to decide whose inbox receives approval codes.
export async function findCompanyAdministrator(companyId: string) {
  const [admin] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(and(eq(users.companyId, companyId), eq(users.role, "admin"), eq(users.active, true), isNull(users.deletedAt)))
    .orderBy(asc(users.createdAt))
    .limit(1);
  return admin || null;
}
