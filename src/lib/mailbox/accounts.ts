// The set of addresses the Platform Owner mailbox operates, and idempotent
// seeding of them. Kept here (not hardcoded across routes) so "more mailboxes
// may be added later" is a one-line change, and so a fresh deploy has the
// three default boxes without a manual DB insert.
import { db } from "@/db";
import { mailboxes } from "@/db/schema";

// The domain is env-overridable (MAILBOX_DOMAIN) but defaults to the product
// domain; the local parts are the three the owner uses.
const DOMAIN = process.env.MAILBOX_DOMAIN || "ziplod.com";

export const DEFAULT_MAILBOXES: { address: string; displayName: string }[] = [
  { address: `support@${DOMAIN}`, displayName: "Support" },
  { address: `sales@${DOMAIN}`, displayName: "Sales" },
  { address: `mail@${DOMAIN}`, displayName: "Mail" },
];

// Upsert the default mailboxes. ON CONFLICT DO NOTHING on the unique address,
// so it's safe to call on every bootstrap and never duplicates or overwrites.
export async function ensureDefaultMailboxes(): Promise<void> {
  await db.insert(mailboxes).values(DEFAULT_MAILBOXES).onConflictDoNothing();
}
