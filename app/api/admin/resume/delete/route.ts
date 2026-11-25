import { NextRequest, NextResponse } from "next/server";
import { forbidden, isSuperAdmin } from "@/lib/admin-auth";
import { deleteResume, isValidId } from "@/lib/profiles";
import { removeProfileLogin } from "@/lib/profile-auth";

export const dynamic = "force-dynamic";

/**
 * POST (super admin) { profile }: delete a profile (active or archived).
 * Its login is removed (open sessions end at once) and its resume is moved to
 * resumes/_deleted/. The application history is kept, so past counts don't change.
 */
export async function POST(request: NextRequest) {
  if (!isSuperAdmin(request)) return forbidden(request);
  let body: { profile?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const profile = String(body.profile ?? "");
  if (!isValidId(profile)) return NextResponse.json({ error: "Invalid profile id" }, { status: 400 });
  try {
    await deleteResume(profile);
    await removeProfileLogin(profile);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 400 });
  }
}
