import { NextRequest, NextResponse } from "next/server";
import { forbidden, isSuperAdmin } from "@/lib/admin-auth";
import { isValidId, readResume, writeResume } from "@/lib/profiles";

export const dynamic = "force-dynamic";


/** GET (admin) ?profile=<id>: the profile's .md. */
export async function GET(request: NextRequest) {
  if (!isSuperAdmin(request)) return forbidden(request);
  const id = request.nextUrl.searchParams.get("profile") ?? "";
  if (!isValidId(id)) return NextResponse.json({ error: "Invalid profile id" }, { status: 400 });
  const markdown = await readResume(id);
  if (markdown === null) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  return NextResponse.json({ markdown });
}

/**
 * PUT (admin) { profile, markdown, create }: save a profile's .md.
 * create=true adds a new profile (its server starts automatically);
 * create=false updates an existing one (used on the next generation, no restart).
 */
export async function PUT(request: NextRequest) {
  if (!isSuperAdmin(request)) return forbidden(request);
  let body: { profile?: unknown; markdown?: unknown; create?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const id = typeof body.profile === "string" ? body.profile.trim() : "";
  const markdown = typeof body.markdown === "string" ? body.markdown : "";
  if (!isValidId(id)) {
    return NextResponse.json(
      { error: "Profile id: lowercase letters, numbers and _ only (e.g. john_smith)" },
      { status: 400 }
    );
  }
  if (!/^#\s+\S/m.test(markdown) || markdown.length > 200000) {
    return NextResponse.json({ error: 'The resume must start with "# Full Name"' }, { status: 400 });
  }
  try {
    await writeResume(id, markdown, body.create === true);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Save failed" }, { status: 400 });
  }
}
