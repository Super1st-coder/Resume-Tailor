import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { setArchived } from "@/lib/profiles";

export const dynamic = "force-dynamic";

/**
 * POST (admin) { profile, archived }: archive a profile (its server stops;
 * the resume, login and application history are kept) or restore it.
 */
export async function POST(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: "Wrong admin password" }, { status: 401 });
  let body: { profile?: unknown; archived?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    await setArchived(String(body.profile ?? ""), body.archived === true);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 400 });
  }
}
