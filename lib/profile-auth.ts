/**
 * Per-profile logins, set on the admin page. The username decides which
 * profile a person sees, so usernames are unique (ignoring case).
 *
 * Stored in data/profile-auth.json (override with PROFILE_AUTH_FILE) as
 * { "<profile>": { user, salt, hash, updated } }. Passwords are scrypt
 * hashes, never stored in plain text.
 */
import { promises as fs } from "fs";
import path from "path";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

type Login = { user: string; salt: string; hash: string; updated: string };
type Store = Record<string, Login>;

function storeFile(): string {
  return process.env.PROFILE_AUTH_FILE || path.join(process.cwd(), "data", "profile-auth.json");
}

async function readStore(): Promise<Store> {
  try {
    return JSON.parse(await fs.readFile(storeFile(), "utf8")) as Store;
  } catch {
    return {};
  }
}

async function writeStore(store: Store): Promise<void> {
  const file = storeFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(tmp, file); // atomic replace
}

const hashPassword = (password: string, salt: string) =>
  scryptSync(password, salt, 32).toString("hex");

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Set (or replace) a profile's username and password. Signs out its open sessions. */
export async function setProfileLogin(profile: string, user: string, password: string): Promise<void> {
  const store = await readStore();
  const taken = Object.entries(store).find(
    ([p, l]) => p !== profile && l.user.toLowerCase() === user.toLowerCase()
  );
  if (taken) throw new Error(`Username "${user}" is already used by another profile`);
  const salt = randomBytes(16).toString("hex");
  store[profile] = { user, salt, hash: hashPassword(password, salt), updated: new Date().toISOString() };
  await writeStore(store);
}

/** Usernames and last-change times per profile (never the passwords). */
export async function listProfileLogins(): Promise<Record<string, { user: string; updated: string }>> {
  const store = await readStore();
  const out: Record<string, { user: string; updated: string }> = {};
  for (const [p, l] of Object.entries(store)) out[p] = { user: l.user, updated: l.updated };
  return out;
}

/** When the profile's login was last set (ms), or null if it has none. */
export async function loginUpdatedAt(profile: string): Promise<number | null> {
  const l = (await readStore())[profile];
  return l ? Date.parse(l.updated) : null;
}

/** The profile whose username + password match, or null. */
export async function findProfileByLogin(user: string, password: string): Promise<string | null> {
  const store = await readStore();
  for (const [profile, l] of Object.entries(store)) {
    if (l.user.toLowerCase() !== user.trim().toLowerCase()) continue;
    return safeEqual(hashPassword(password, l.salt), l.hash) ? profile : null;
  }
  // Unknown user: still spend the hashing time so timing doesn't reveal usernames.
  hashPassword(password, "0000000000000000");
  return null;
}
