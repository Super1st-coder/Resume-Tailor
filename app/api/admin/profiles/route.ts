import { NextRequest, NextResponse } from "next/server";
import { adminRole, forbidden, isSuperAdmin } from "@/lib/admin-auth";
import { listProfileLogins, setProfileLogin } from "@/lib/profile-auth";
import { activeIds, archivedIds, displayName, readResume } from "@/lib/profiles";

export const dynamic = "force-dynamic";

const unauthorized = () => NextResponse.json({ error: "Wrong admin password" }, { status: 401 });

/** GET (admin): active + archived profiles with their login username. */
export async function GET(request: NextRequest) {
  const role = adminRole(request);
  if (!role) return unauthorized();
  const showLogins = role === "super"; // general admins don't see usernames
  const [logins, active, archived] = await Promise.all([
    listProfileLogins(),
    activeIds(),
    archivedIds(),
  ]);
  const describe = async (id: string, isArchived: boolean) => {
    const md = (await readResume(id)) ?? "";
    return {
      id,
      name: displayName(md, id),
      archived: isArchived,
      user: showLogins ? logins[id]?.user ?? null : null,
      updated: showLogins ? logins[id]?.updated ?? null : null,
    };
  };
  const profiles = await Promise.all([
    ...active.map((id) => describe(id, false)),
    ...archived.map((id) => describe(id, true)),
  ]);
  return NextResponse.json({ profiles });
}

/** PUT (super admin): { profile, username, password } sets that profile's login. */
export async function PUT(request: NextRequest) {
  if (!isSuperAdmin(request)) return forbidden(request);
  let body: { profile?: unknown; username?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const profile = typeof body.profile === "string" ? body.profile : "";
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (![...(await activeIds()), ...(await archivedIds())].includes(profile)) {
    return NextResponse.json({ error: "Unknown profile" }, { status: 400 });
  }
  if (!username || username.includes(":") || username.length > 100) {
    return NextResponse.json({ error: "Username is required and can't contain ':'" }, { status: 400 });
  }
  if (password.length < 6 || password.length > 200) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }
  try {
    await setProfileLogin(profile, username, password);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Save failed" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
