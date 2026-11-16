/**
 * Login sessions (server side). One server serves every profile; the
 * signed-in profile comes from the "rt_session" cookie:
 *
 *   <profile>.<issuedAtMs>.<hmac-sha256 hex of "<profile>.<issuedAtMs>">
 *
 * signed with SESSION_SECRET. middleware.ts checks the signature on every
 * request and passes the profile on in the x-profile header; route handlers
 * call requireProfile() to also check the profile is still active and its
 * password hasn't changed since the login.
 */
import type { NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { activeIds } from "@/lib/profiles";
import { loginUpdatedAt } from "@/lib/profile-auth";

export const SESSION_COOKIE = "rt_session";
export const SESSION_DAYS = 30;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not configured");
  return s;
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("hex");

export function createSessionValue(profile: string): string {
  const payload = `${profile}.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}

export function parseSessionValue(value: string | undefined): { profile: string; iat: number } | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [profile, iatRaw, sig] = parts;
  const expected = Buffer.from(sign(`${profile}.${iatRaw}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const iat = Number(iatRaw);
  if (!Number.isFinite(iat) || Date.now() - iat > SESSION_DAYS * 86400000) return null;
  return { profile, iat };
}

export class NotSignedIn extends Error {}

/**
 * The signed-in profile for an API request. Throws NotSignedIn when there is
 * no valid session, the profile was archived, or its password was changed
 * after this login.
 */
export async function requireProfile(request: NextRequest): Promise<string> {
  const session = parseSessionValue(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) throw new NotSignedIn("Please sign in");
  if (!(await activeIds()).includes(session.profile)) throw new NotSignedIn("This profile is not active");
  const changed = await loginUpdatedAt(session.profile);
  if (!changed || changed > session.iat) throw new NotSignedIn("Please sign in again");
  return session.profile;
}
