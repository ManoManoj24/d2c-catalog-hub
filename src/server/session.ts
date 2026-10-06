import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { sessionSecret } from "./env";

const SESSION = "pim_session";
const TENANT = "pim_tenant";
const MAX_AGE_SECONDS = 60 * 60 * 12;

type SessionPayload = { uid: string; exp: number };

function sign(payload: string): string {
  const mac = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

function verify(token: string): string | null {
  const splitAt = token.lastIndexOf(".");
  if (splitAt <= 0) return null;
  const payload = token.slice(0, splitAt);
  const mac = token.slice(splitAt + 1);
  const expected = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  const left = Buffer.from(mac);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  return payload;
}

export function sealSession(userId: string): string {
  const payload: SessionPayload = { uid: userId, exp: Date.now() + MAX_AGE_SECONDS * 1000 };
  return sign(Buffer.from(JSON.stringify(payload)).toString("base64url"));
}

export function openSession(token: string | undefined): string | null {
  if (!token) return null;
  const payload = verify(token);
  if (!payload) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as SessionPayload;
    if (!parsed.uid || parsed.exp < Date.now()) return null;
    return parsed.uid;
  } catch {
    return null;
  }
}

export async function writeSession(userId: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION, sealSession(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION);
  jar.delete(TENANT);
}

export async function readUserId(): Promise<string | null> {
  const jar = await cookies();
  return openSession(jar.get(SESSION)?.value);
}

export async function readTenantCookie(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(TENANT)?.value ?? null;
}

export async function writeTenantCookie(tenantId: string): Promise<void> {
  const jar = await cookies();
  jar.set(TENANT, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export function signObject(key: string, expiresAt: number): string {
  return createHmac("sha256", sessionSecret()).update(`${expiresAt}.${key}`).digest("base64url");
}

export function verifyObject(key: string, expiresAt: number, signature: string): boolean {
  if (expiresAt < Date.now()) return false;
  const expected = signObject(key, expiresAt);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
