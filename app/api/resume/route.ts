import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

// Read the file on every request. Without this, `next build` pre-renders the
// route once and every instance serves the resume that existed at build time,
// ignoring each instance's RESUME_INPUT_FILE.
export const dynamic = "force-dynamic";

/** File whose contents pre-fill the Resume field. Override with RESUME_INPUT_FILE. */
const RESUME_FILE =
  process.env.RESUME_INPUT_FILE || path.join(process.cwd(), "show_resume.txt");

export async function GET() {
  try {
    const content = await fs.readFile(RESUME_FILE, "utf8");
    return NextResponse.json({ content });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      // File not present yet — return empty so the field stays editable.
      return NextResponse.json({ content: "" });
    }
    const msg = err instanceof Error ? err.message : "Failed to read resume file";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
