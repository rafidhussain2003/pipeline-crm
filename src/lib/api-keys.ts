import crypto from "crypto";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

// Same one-way hashing pattern already used for passwords (bcrypt) and
// refresh tokens (sha256, see src/lib/refresh-tokens.ts) — the raw key is
// returned to the caller exactly once, at creation time, and is never
// recoverable again; only its hash is stored.
const KEY_PREFIX = "pk_live_";

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export async function createApiKey(companyId: string, name: string, scopes: string[], createdBy: string | null) {
  const secret = crypto.randomBytes(24).toString("hex");
  const rawKey = `${KEY_PREFIX}${secret}`;
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, 12);

  const [row] = await db
    .insert(apiKeys)
    .values({ companyId, name, keyHash, keyPrefix, scopes, createdBy })
    .returning();

  return { id: row.id, rawKey, keyPrefix: row.keyPrefix, name: row.name, scopes };
}

export async function listApiKeys(companyId: string) {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      scopes: apiKeys.scopes,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.companyId, companyId));
}

export async function revokeApiKey(companyId: string, keyId: string) {
  const [row] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.companyId, companyId)))
    .returning();
  return row || null;
}

// Rotation = revoke the old key and issue a new one with the same
// name/scopes/owner. Returns null if the key doesn't exist (or belongs to
// a different company) — callers should treat that as 404, same as revoke.
export async function rotateApiKey(companyId: string, keyId: string) {
  const [existing] = await db
    .select({ name: apiKeys.name, scopes: apiKeys.scopes, createdBy: apiKeys.createdBy })
    .from(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.companyId, companyId)))
    .limit(1);
  if (!existing) return null;

  const revoked = await revokeApiKey(companyId, keyId);
  if (!revoked) return null;

  return createApiKey(companyId, existing.name, (existing.scopes as string[]) || [], existing.createdBy);
}

export type ApiKeyAuthResult = { valid: true; companyId: string; scopes: string[] } | { valid: false };

// Not wired into any business-data route yet — this is the verification
// primitive a route would call once the product decides which endpoints
// get exposed publicly (see the report's remaining-gaps section on
// versioning, which is the other prerequisite for that).
export async function verifyApiKey(rawKey: string, requiredScope?: string): Promise<ApiKeyAuthResult> {
  const keyHash = hashKey(rawKey);
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!row) return { valid: false };

  const scopes = (row.scopes as string[]) || [];
  if (requiredScope && !scopes.includes(requiredScope)) return { valid: false };

  // Not awaited: usage tracking shouldn't add latency to every
  // API-key-authenticated request. A lost update here (e.g. a process
  // restart mid-write) only makes lastUsedAt slightly stale — it never
  // affects the authorization decision above, which has already completed.
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id))
    .catch((err) => console.error("Failed to update api key lastUsedAt:", err));

  return { valid: true, companyId: row.companyId, scopes };
}
