import { NextRequest, NextResponse } from "next/server";
import { forbidden, isSuperAdmin } from "@/lib/admin-auth";
import { pdfToText, resumeTextToMarkdown } from "@/lib/resume-convert";
import { activeIds, archivedIds, displayName, idFromName } from "@/lib/profiles";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * POST (admin), multipart form with "file" (a resume PDF) or "text" (pasted
 * resume): returns the profile Markdown for review, plus a suggested id.
 */
export async function POST(request: NextRequest) {
  if (!isSuperAdmin(request)) return forbidden(request);
  try {
    const form = await request.formData();
    const file = form.get("file");
    let text = typeof form.get("text") === "string" ? String(form.get("text")).trim() : "";
    if (file && typeof file !== "string") {
      if (file.size > MAX_BYTES) return NextResponse.json({ error: "PDF is larger than 10 MB" }, { status: 400 });
      const buf = Buffer.from(await file.arrayBuffer());
      if (buf.subarray(0, 5).toString() !== "%PDF-") {
        return NextResponse.json({ error: "That file is not a PDF" }, { status: 400 });
      }
      text = await pdfToText(buf);
    }
    if (!text) return NextResponse.json({ error: "Upload a PDF or paste the resume text" }, { status: 400 });

    const markdown = await resumeTextToMarkdown(text);
    const name = displayName(markdown, "");
    // Suggest a free id from the name: "Marcin Pham" -> marcin_pham (or marcin_pham_2).
    const taken = new Set([...(await activeIds()), ...(await archivedIds())]);
    const base = idFromName(name);
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
    return NextResponse.json({ markdown, name, suggestedId: id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Conversion failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
