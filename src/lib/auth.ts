import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const COOKIE_NAME = "crm_session";
const REFRESH_COOKIE_NAME = "crm_refresh";

export type SessionPayload = {
  userId: string;
  companyId: string | null;
  role: "super_admin" | "admin" | "agent";
  email: string;
};

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function signSession(payload: SessionPayload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as SessionPayload;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function setSessionCookie(payload: SessionPayload) {
  const store = await cookies();
  store.set(COOKIE_NAME, signSession(payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

// --- Refresh token cookie (separate, DB-backed, revocable) ---
// The access token above is a self-contained JWT (fast to verify, no DB hit
// on every request). The refresh token is an opaque random value checked
// against the `refresh_tokens` table (see lib/refresh-tokens.ts), so it can
// be revoked (logout, "sign out all devices", admin-forced logout) in a way
// a stateless JWT alone never can. See /api/auth/refresh.
export async function setRefreshCookie(rawToken: string, expiresAt: Date) {
  const store = await cookies();
  store.set(REFRESH_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth",
    expires: expiresAt,
  });
}

export async function getRefreshCookie() {
  const store = await cookies();
  return store.get(REFRESH_COOKIE_NAME)?.value || null;
}

export async function clearRefreshCookie() {
  const store = await cookies();
  store.delete(REFRESH_COOKIE_NAME);
}

export const COOKIE_KEY = COOKIE_NAME;
export const REFRESH_COOKIE_KEY = REFRESH_COOKIE_NAME;

// Generic short-lived signed token helpers, used for the Facebook OAuth
// `state` param and for temporarily holding fetched page tokens between the
// OAuth callback and the user picking which pages to connect.
export function signShortLived(payload: object, expiresIn: string = "10m") {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: expiresIn as jwt.SignOptions["expiresIn"] });
}

export function verifyShortLived<T>(token: string): T | null {
  try {
    return jwt.verify(token, JWT_SECRET) as T;
  } catch {
    return null;
  }
}
