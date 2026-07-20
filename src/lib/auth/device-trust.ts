// Enterprise Agent Portal — trusted devices (Parts 8/9 of the portal spec).
//
// A device becomes trusted by passing an email OTP at login. The browser
// keeps a random token in an httpOnly cookie; the table stores only its
// SHA-256 (same discipline as refresh_tokens). While a live row matches,
// logins from that browser need username + password only; everything else
// gets the OTP challenge. Trust ends when the Remember-Me window elapses or
// an administrator forces a logout (password reset / deactivation) — plain
// logout deliberately keeps the trust, per the spec.
import crypto from "crypto";
import { db } from "@/db";
import { trustedDevices } from "@/db/schema";
import { and, eq, gt, isNull } from "drizzle-orm";

export const DEVICE_COOKIE_NAME = "crm_device";

// Deliberately the same window as Remember Me: "trusted remembered devices
// should not require OTP again until Remember Me expires".
export const DEVICE_TRUST_DAYS = 30;

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function isTrustedDevice(userId: string, rawToken: string): Promise<boolean> {
  const [row] = await db
    .select({ id: trustedDevices.id })
    .from(trustedDevices)
    .where(
      and(
        eq(trustedDevices.userId, userId),
        eq(trustedDevices.tokenHash, hashToken(rawToken)),
        isNull(trustedDevices.revokedAt),
        gt(trustedDevices.expiresAt, new Date())
      )
    )
    .limit(1);
  if (!row) return false;
  // Best-effort freshness stamp — a failure here must never fail a login.
  db.update(trustedDevices)
    .set({ lastUsedAt: new Date() })
    .where(eq(trustedDevices.id, row.id))
    .catch(() => {});
  return true;
}

export async function registerTrustedDevice(userId: string, userAgent?: string): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + DEVICE_TRUST_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(trustedDevices).values({
    userId,
    tokenHash: hashToken(rawToken),
    userAgent: userAgent?.slice(0, 255),
    expiresAt,
    lastUsedAt: new Date(),
  });
  return { rawToken, expiresAt };
}

// "Administrator forces logout": the user's next login must pass an OTP
// again from every device.
export async function revokeTrustedDevicesForUser(userId: string): Promise<void> {
  await db.update(trustedDevices).set({ revokedAt: new Date() }).where(and(eq(trustedDevices.userId, userId), isNull(trustedDevices.revokedAt)));
}
