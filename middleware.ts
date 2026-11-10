import { NextRequest, NextResponse } from "next/server";

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

export function middleware(request: NextRequest) {
  const allowed = getAllowedIps();
  if (allowed.length === 0) {
    return NextResponse.next();
  }

  const clientIp = getClientIp(request);
  if (allowed.includes(clientIp)) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname === "/blocked") {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL("/blocked", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
