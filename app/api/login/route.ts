import { NextRequest, NextResponse } from "next/server";
import { findProfileByLogin } from "@/lib/profile-auth";
import { activeIds } from "@/lib/profiles";
import { SESSION_COOKIE, SESSION_DAYS, createSessionValue } from "@/lib/session";

export const dynamic = "force-dynamic";

// Slow down password guessing: max 10 failed logins per IP per 15 minutes.
const failures = new Map<string, { count: number; until: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;

function clientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.ip || "unknown";
}

/** POST { username, password } -> sets the session cookie for that profile. */
export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  const f = failures.get(ip);
  if (f && f.until > Date.now() && f.count >= MAX_FAILS) {
    return NextResponse.json({ error: "Too many failed attempts. Try again in 15 minutes." }, { status: 429 });
  }

  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";

  const profile = username && password ? await findProfileByLogin(username, password) : null;
  if (!profile || !(await activeIds()).includes(profile)) {
    const cur = f && f.until > Date.now() ? f : { count: 0, until: Date.now() + WINDOW_MS };
    cur.count++;
    failures.set(ip, cur);
    return NextResponse.json({ error: "Wrong username or password" }, { status: 401 });
  }

  failures.delete(ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, createSessionValue(profile), {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
  return res;
}
