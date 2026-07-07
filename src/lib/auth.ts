import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { roleEnum } from "@/db/schema";

// Validated once, at module load (i.e. app startup — this module is
// imported before any request is handled). Returning a plain `string`
// here (not narrowing `process.env.X` in place) is deliberate: TypeScript
// does not carry an `if (!x) throw` guard's narrowing into functions
// declared later in the same module, so `JWT_SECRET` would still be typed
// `string | undefined` at every call site below without this — forcing
// either an `as string` cast or a `!` assertion at each use. Giving this
// function an explicit `string` return type fixes that everywhere at once,
// with no cast needed anywhere.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Fail loudly instead of silently signing sessions with a known,
    // publicly-visible fallback secret. render.yaml always sets this via
    // generateValue: true, so this should never trigger in the deployed app.
    throw new Error(`${name} environment variable must be set.`);
  }
  return value;
}

const JWT_SECRET = requireEnv("JWT_SECRET");
const COOKIE_NAME = "crm_session";
const REFRESH_COOKIE_NAME = "crm_refresh";

// Derived from the schema's role enum (not hardcoded here a second time) —
// adding a role only ever means updating schema.ts, not hunting down every
// place a role union type was independently retyped.
export type SessionPayload = {
  userId: string;
  companyId: string | null;
  role: (typeof roleEnum.enumValues)[number];
  email: string;
};

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

const DEFAULT_SESSION_DAYS = 7;
const REMEMBER_ME_SESSION_DAYS = 30;

export function signSession(payload: SessionPayload, maxAgeDays: number = DEFAULT_SESSION_DAYS) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: `${maxAgeDays}d` as jwt.SignOptions["expiresIn"] });
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

// The `const session = await getSession(); if (!session || !session.companyId)
// return NextResponse.json({ error: "Unauthorized" }, { status: 401 });`
// pattern is repeated near-identically across most API routes. This
// extracts it — the caller still does its own `if (!ok) return response;`,
// so control flow at each call site stays explicit and unchanged.
export type CompanySession = SessionPayload & { companyId: string };

export async function requireCompanySession(): Promise<
  { ok: true; session: CompanySession } | { ok: false; response: NextResponse }
> {
  const session = await getSession();
  if (!session || !session.companyId) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { ok: true, session: session as CompanySession };
}

export async function setSessionCookie(payload: SessionPayload, maxAgeDays: number = DEFAULT_SESSION_DAYS) {
  const store = await cookies();
  store.set(COOKIE_NAME, signSession(payload, maxAgeDays), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * maxAgeDays,
  });
}

// Exported so routes accepting a "remember me" option can opt into it
// without hardcoding the number themselves.
export { REMEMBER_ME_SESSION_DAYS };

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
