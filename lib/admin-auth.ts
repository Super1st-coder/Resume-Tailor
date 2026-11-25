import type { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";

/**
 * Two admin levels, each with its own password in .env (sent in the x-admin-key header):
 *   SUPERADMIN_PASSWORD -> "super": everything (profiles, logins, resumes, import).
 *   ADMIN_PASSWORD      -> "admin": view application counts and history, export CSV.
 */
export type AdminRole = "super" | "admin";

function matches(given: string, secret: string | undefined): boolean {
  if (!secret) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function adminRole(request: NextRequest): AdminRole | null {
  const given = request.headers.get("x-admin-key") ?? "";
  if (!given) return null;
  if (matches(given, process.env.SUPERADMIN_PASSWORD)) return "super";
  if (matches(given, process.env.ADMIN_PASSWORD)) return "admin";
  return null;
}

/** Any admin (general or super). */
export const isAdmin = (request: NextRequest) => adminRole(request) !== null;

/** Super admin only. */
export const isSuperAdmin = (request: NextRequest) => adminRole(request) === "super";

/** 401 for a wrong password, 403 when a general admin tries a super-admin action. */
export function forbidden(request: NextRequest): Response {
  const role = adminRole(request);
  return Response.json(
    role ? { error: "Only the super admin can do this" } : { error: "Wrong admin password" },
    { status: role ? 403 : 401 }
  );
}
