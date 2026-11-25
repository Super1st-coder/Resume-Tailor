/**
 * Profile files: every resumes/<id>.md is one candidate.
 * Archived profiles live in resumes/_archived/<id>.md (can't sign in; history kept).
 *
 * One server serves every profile; the signed-in login decides which one.
 */
import { promises as fs } from "fs";
import path from "path";

export const resumesDir = () => path.join(process.cwd(), "resumes");
export const archiveDir = () => path.join(resumesDir(), "_archived");

/** Profile ids: lowercase letters, digits and underscores (used as file names). */
export const isValidId = (id: string) => /^[a-z0-9][a-z0-9_]{0,59}$/.test(id);

/** "Marcin Pham" -> "marcin_pham" */
export function idFromName(name: string): string {
  const id = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return id || "profile";
}

/** Turn "# MARCIN PHAM" into "Marcin Pham". */
export function displayName(md: string, fallback: string): string {
  const raw = md.match(/^#\s+(.+)$/m)?.[1]?.replace(/[*_`]/g, "").trim() || fallback.replace(/[_-]+/g, " ");
  return raw.toLowerCase().replace(/(^|[\s'-])(\S)/g, (_, s: string, c: string) => s + c.toUpperCase());
}

async function mdIds(dir: string): Promise<string[]> {
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  return files
    .filter((f) => f.toLowerCase().endsWith(".md"))
    .map((f) => f.slice(0, -3))
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

export const activeIds = () => mdIds(resumesDir());
export const archivedIds = () => mdIds(archiveDir());

function fileFor(id: string, archived = false): string {
  if (!isValidId(id)) throw new Error("Invalid profile id");
  return path.join(archived ? archiveDir() : resumesDir(), `${id}.md`);
}

const exists = (p: string) => fs.access(p).then(() => true, () => false);

export async function readResume(id: string): Promise<string | null> {
  for (const archived of [false, true]) {
    try {
      return await fs.readFile(fileFor(id, archived), "utf8");
    } catch {
      /* try the next place */
    }
  }
  return null;
}

/** Write a profile's .md (atomic). `create` fails if the id is already used. */
export async function writeResume(id: string, markdown: string, create: boolean): Promise<void> {
  const file = fileFor(id);
  const taken = (await exists(file)) || (await exists(fileFor(id, true)));
  if (create && taken) throw new Error(`A profile named "${id}" already exists`);
  if (!create && !(await exists(file))) throw new Error("Profile not found");
  // Temp file in the same folder as the resume: rename() only works within one file system,
  // and in Docker resumes/ is a separate mount from the rest of the app (EXDEV otherwise).
  // Profiles are listed from *.md files only, so the .tmp file is never seen as a profile.
  const tmp = path.join(path.dirname(file), `.${id}.${process.pid}.tmp`);
  await fs.writeFile(tmp, markdown.replace(/\r\n/g, "\n").trimEnd() + "\n", "utf8");
  await fs.rename(tmp, file);
}

/** Where deleted profiles' resumes are moved (not listed anywhere; kept for manual recovery). */
export const deletedDir = () => path.join(resumesDir(), "_deleted");

/**
 * Delete a profile (active or archived): its resume file is moved to
 * resumes/_deleted/<id>-<time>.md, so the id is free again. The caller removes the login.
 */
export async function deleteResume(id: string): Promise<void> {
  const sources = [fileFor(id), fileFor(id, true)];
  const found: string[] = [];
  for (const f of sources) if (await exists(f)) found.push(f);
  if (found.length === 0) throw new Error("Profile not found");
  await fs.mkdir(deletedDir(), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (let i = 0; i < found.length; i++) {
    await fs.rename(found[i], path.join(deletedDir(), `${id}-${stamp}${i ? `-${i}` : ""}.md`));
  }
}

/** Archive (stop the server, keep the file and history) or restore a profile. */
export async function setArchived(id: string, archived: boolean): Promise<void> {
  const from = fileFor(id, !archived);
  const to = fileFor(id, archived);
  if (!(await exists(from))) throw new Error("Profile not found");
  if (await exists(to)) throw new Error("A profile with this id already exists there");
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.rename(from, to);
}
