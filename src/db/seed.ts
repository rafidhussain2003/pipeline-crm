import "dotenv/config";
import { db } from "./index";
import { users } from "./schema";
import { hashPassword } from "../lib/auth";
import { eq } from "drizzle-orm";

async function main() {
  const email = process.env.SEED_SUPER_ADMIN_EMAIL || "admin@yourcompany.com";
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD || "changeme123";

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    console.log(`Super admin ${email} already exists. Skipping.`);
    process.exit(0);
  }

  const passwordHash = await hashPassword(password);
  await db.insert(users).values({
    companyId: null,
    name: "Super Admin",
    email,
    passwordHash,
    role: "super_admin",
    tier: null,
    active: true,
  });

  console.log(`Created super admin: ${email} / ${password}`);
  console.log("Log in and change this password immediately in production.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
