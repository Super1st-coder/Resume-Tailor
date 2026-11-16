import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

/** POST: sign out (clears the session cookie). */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
