import { NextRequest, NextResponse } from "next/server";
import { adminRole, forbidden, isSuperAdmin } from "@/lib/admin-auth";
import { promises as fs } from "fs";
import path from "path";
import { importApplications, listApplications } from "@/lib/applications";

export const dynamic = "force-dynamic";


const unauthorized = () => NextResponse.json({ error: "Wrong admin password" }, { status: 401 });

/** GET (admin): every application, newest first. */
export async function GET(request: NextRequest) {
  const role = adminRole(request);
  if (!role) return unauthorized();
  const all = await listApplications();
  // General admins only see counts: send time + profile, no company/role/file/IP.
  const applications =
    role === "super" ? all : all.map((a) => ({ id: a.id, time: a.time, profile: a.profile, company: "", role: "", filename: "", ip: "" }));
  return NextResponse.json({ applications, role });
}

// Applications are recorded by /api/chat when a resume is generated.
// There is deliberately no delete: the history is kept forever.

/**
 * PUT (super admin): import past applications from resume file names.
 * Body: { profile, items: [{ company, role, filename, time }] }. Add-only.
 */
export async function PUT(request: NextRequest) {
  if (!isSuperAdmin(request)) return forbidden(request);
  let body: { profile?: unknown; items?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const profile = typeof body.profile === "string" ? body.profile.trim() : "";
  // Only real profiles (resumes/<profile>.md) can receive imports.
  const known = (await fs.readdir(path.join(process.cwd(), "resumes")).catch(() => [] as string[]))
    .filter((f) => f.toLowerCase().endsWith(".md"))
    .map((f) => f.replace(/\.md$/i, ""));
  if (!known.includes(profile)) {
    return NextResponse.json({ error: "Unknown profile" }, { status: 400 });
  }
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 1000) {
    return NextResponse.json({ error: "Send 1 to 1000 items" }, { status: 400 });
  }
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.ip || "unknown";
  const result = await importApplications(profile, body.items, ip);
  return NextResponse.json(result);
}
