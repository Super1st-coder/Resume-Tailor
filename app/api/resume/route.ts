import { NextRequest, NextResponse } from "next/server";
import { readResume } from "@/lib/profiles";
import { NotSignedIn, requireProfile } from "@/lib/session";

// Read the file on every request: each signed-in profile gets its own resume.
export const dynamic = "force-dynamic";

/** The signed-in profile's base resume (resumes/<profile>.md). */
export async function GET(request: NextRequest) {
  try {
    const profile = await requireProfile(request);
    const content = await readResume(profile);
    return NextResponse.json({ content: content ?? "", profile });
  } catch (err) {
    if (err instanceof NotSignedIn) return NextResponse.json({ error: err.message }, { status: 401 });
    const msg = err instanceof Error ? err.message : "Failed to read resume file";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
