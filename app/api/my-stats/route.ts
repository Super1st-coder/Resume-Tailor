import { NextRequest, NextResponse } from "next/server";
import { listApplications } from "@/lib/applications";
import { NotSignedIn, requireProfile } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * GET (signed-in candidate): times of this profile's own applications from the
 * last 3 days. The browser counts "today" and "yesterday" in its own time zone.
 * Only times are sent: no companies, other profiles or IPs.
 */
export async function GET(request: NextRequest) {
  try {
    const profile = await requireProfile(request);
    const since = Date.now() - 3 * 24 * 60 * 60 * 1000;
    const times = (await listApplications())
      .filter((a) => a.profile === profile && Date.parse(a.time) >= since)
      .map((a) => a.time);
    return NextResponse.json({ times });
  } catch (err) {
    if (err instanceof NotSignedIn) return NextResponse.json({ error: err.message }, { status: 401 });
    return NextResponse.json({ error: "Failed to read counts" }, { status: 500 });
  }
}
