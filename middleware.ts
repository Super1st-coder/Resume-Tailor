import { NextRequest, NextResponse } from "next/server";

/**
 * One server for every profile:
 *   /admin  -> admin page (protected by the admin password, not a profile login)
 *   /login  -> sign in with a profile's username + password
 *   anything else -> needs a signed-in profile (rt_session cookie, see lib/session.ts)
 *
 * The cookie signature and age are checked here; route handlers additionally
 * check the profile is still active and its password unchanged.
 */

const SESSION_COOKIE = "rt_session";
const SESSION_DAYS = 30;

function getAllowedIps(): string[] {
  const raw = process.env.ALLOWED_IPS;
  if (!raw || !raw.trim()) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

/** Paths that don't need a profile login. */
function isPublic(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/api/login" ||
    pathname === "/api/logout" ||
    pathname === "/blocked" ||
    pathname === "/icon.svg" ||
    // Admin page and its APIs check the admin password themselves.
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/api/applications" ||
    pathname.startsWith("/api/admin/")
  );
}

let keyPromise: Promise<CryptoKey> | null = null;
function hmacKey(secret: string): Promise<CryptoKey> {
  keyPromise ??= crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return keyPromise;
}

/** Valid session cookie -> its profile id; otherwise null. */
async function sessionProfile(request: NextRequest): Promise<string | null> {
  const secret = process.env.SESSION_SECRET;
  const value = request.cookies.get(SESSION_COOKIE)?.value;
  if (!secret || !value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [profile, iat, sig] = parts;
  if (!Number.isFinite(Number(iat)) || Date.now() - Number(iat) > SESSION_DAYS * 86400000) return null;
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(`${profile}.${iat}`));
  const expected = Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? profile : null;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const allowed = getAllowedIps();
  if (allowed.length > 0 && pathname !== "/blocked" && !allowed.includes(getClientIp(request))) {
    return NextResponse.redirect(new URL("/blocked", request.url));
  }

  const profile = await sessionProfile(request);

  // Already signed in: the login page goes straight to the app.
  if (pathname === "/login" && profile) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (isPublic(pathname) || profile) {
    return NextResponse.next();
  }

  // Not signed in.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  login.search = "";
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
