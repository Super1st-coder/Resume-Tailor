/**
 * Job application history, shared by every profile server and kept forever.
 *
 * One JSON object per line in data/applications.jsonl (override with
 * APPLICATIONS_FILE). The file is append-only: entries are only ever added,
 * never changed or deleted, so servers writing at the same time can't
 * overwrite each other and no history is lost.
 */
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type Application = {
  id: string;
  /** ISO time (UTC) the resume was generated. */
  time: string;
  /** Profile id = the resumes/*.md file name without .md, e.g. "marcin_pham". */
  profile: string;
  company: string;
  role: string;
  filename: string;
  ip: string;
  /** Job posting link the resume was generated from (only when a link was used). */
  link?: string;
  /** "import" when added from past resume files on the admin page. */
  source?: string;
};

/** The job link if it is a valid http(s) URL, else "" (never store javascript: etc.). */
function cleanLink(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) return "";
  try {
    const u = new URL(input.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString().slice(0, 2000) : "";
  } catch {
    return "";
  }
}

function dataFile(): string {
  return process.env.APPLICATIONS_FILE || path.join(process.cwd(), "data", "applications.jsonl");
}

const clip = (s: unknown, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : "");

export async function recordApplication(input: {
  profile: string;
  company?: unknown;
  role?: unknown;
  filename?: unknown;
  link?: unknown;
  ip: string;
}): Promise<Application> {
  const link = cleanLink(input.link);
  const entry: Application = {
    id: randomUUID(),
    time: new Date().toISOString(),
    profile: input.profile,
    company: clip(input.company, 200),
    role: clip(input.role, 200),
    filename: clip(input.filename, 300),
    ip: clip(input.ip, 100),
    ...(link ? { link } : {}),
  };
  const file = dataFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, JSON.stringify(entry) + "\n", "utf8");
  return entry;
}

/**
 * Add past applications (e.g. resumes made before counting existed).
 * Append-only like everything else. An item is skipped when the same
 * profile already has the same company within 15 minutes of that time,
 * so importing the same files twice never double-counts.
 */
export async function importApplications(
  profile: string,
  items: { company?: unknown; role?: unknown; filename?: unknown; time?: unknown }[],
  ip: string
): Promise<{ added: number; skipped: number }> {
  const existing = await listApplications();
  const WINDOW = 15 * 60 * 1000;
  const seen = existing
    .filter((e) => e.profile === profile)
    .map((e) => ({ company: e.company.toLowerCase(), t: Date.parse(e.time) }));

  const lines: string[] = [];
  let skipped = 0;
  for (const item of items) {
    const company = clip(item.company, 200);
    const t = typeof item.time === "string" ? Date.parse(item.time) : NaN;
    if (!company || !Number.isFinite(t) || t > Date.now() + 60000) {
      skipped++;
      continue;
    }
    const key = company.toLowerCase();
    if (seen.some((s) => s.company === key && Math.abs(s.t - t) < WINDOW)) {
      skipped++;
      continue;
    }
    seen.push({ company: key, t });
    const entry: Application = {
      id: randomUUID(),
      time: new Date(t).toISOString(),
      profile,
      company,
      role: clip(item.role, 200),
      filename: clip(item.filename, 300),
      ip: clip(ip, 100),
      source: "import",
    };
    lines.push(JSON.stringify(entry));
  }
  if (lines.length) {
    const file = dataFile();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, lines.join("\n") + "\n", "utf8");
  }
  return { added: lines.length, skipped };
}

/** Every application ever recorded, newest first. */
export async function listApplications(): Promise<Application[]> {
  let raw = "";
  try {
    raw = await fs.readFile(dataFile(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw err;
  }
  const entries: Application[] = [];
  for (const text of raw.split("\n")) {
    if (!text.trim()) continue;
    try {
      const line = JSON.parse(text) as Partial<Application>;
      if (line.id && line.time) entries.push(line as Application);
    } catch {
      /* skip a damaged line */
    }
  }
  return entries.sort((a, b) => (a.time < b.time ? 1 : -1));
}
