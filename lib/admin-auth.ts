import type { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";

/** Admin calls send the ADMIN_PASSWORD from .env in the x-admin-key header. */
export function isAdmin(request: NextRequest): boolean {
  const secret = process.env.ADMIN_PASSWORD;
  const given = request.headers.get("x-admin-key") ?? "";
  if (!secret) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
