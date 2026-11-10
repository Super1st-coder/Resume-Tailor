import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/** Base directory where tailored resumes are stored. Override with RESUME_SAVE_DIR. */
const BASE_DIR = process.env.RESUME_SAVE_DIR || "D:\\Resume";

/** Names Windows reserves for devices; a folder with one of these names can't be opened. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/**
 * Make a string safe to use as a single Windows folder/file name.
 * Text copied from job sites often carries invisible characters (zero-width
 * spaces, BOM, direction marks, non-breaking spaces) or ends with a dot/space;
 * Windows Explorer then reports "Location is not available" for the folder.
 */
function sanitizeSegment(input: string): string {
  let cleaned = input
    .normalize("NFKC") // fullwidth/compatibility chars -> plain ones
    .replace(/[\\/:*?"<>|]/g, " ") // characters Windows forbids in names
    // control chars, soft hyphen, zero-width/direction marks, BOM, line separators, private-use
    .replace(
      /[\x00-\x1f\x7f-\x9f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb\ue000-\uf8ff]/g,
      ""
    )
    .replace(/\s+/g, " ") // any whitespace (incl. non-breaking) -> one plain space
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, ""); // no leading dots, no trailing dots/spaces

  // Keep well under Windows' path-length limit.
  if (cleaned.length > 80) cleaned = cleaned.slice(0, 80).replace(/[.\s]+$/g, "");
  if (WINDOWS_RESERVED.test(cleaned)) cleaned = `_${cleaned}`;
  return cleaned || "untitled";
}

/**
 * Convert a saved .docx to .pdf using the installed MS Word (COM automation).
 * Produces a PDF identical to how Word renders the document. Returns the PDF path.
 */
async function convertDocxToPdf(docxPath: string): Promise<string> {
  const pdfPath = docxPath.replace(/\.docx$/i, ".pdf");
  const esc = (p: string) => p.replace(/'/g, "''");
  const script =
    "$ErrorActionPreference='Stop';" +
    "$w=New-Object -ComObject Word.Application;" +
    "$w.Visible=$false;" +
    "try{" +
    `$d=$w.Documents.Open('${esc(docxPath)}',$false,$true);` +
    `$d.ExportAsFixedFormat('${esc(pdfPath)}',17);` +
    "$d.Close($false);" +
    "}finally{$w.Quit()}";
  await execAsync(
    `powershell -NoProfile -NonInteractive -Command "${script}"`,
    { timeout: 120000, windowsHide: true }
  );
  return pdfPath;
}

export async function POST(request: NextRequest) {
  let body: {
    name?: string;
    folder?: string;
    filename?: string;
    dataBase64?: string;
    jobDescription?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const personName = sanitizeSegment(typeof body.name === "string" ? body.name : "");
  const folder = sanitizeSegment(typeof body.folder === "string" ? body.folder : "");

  let filename = sanitizeSegment(typeof body.filename === "string" ? body.filename : "");
  if (!/\.docx$/i.test(filename)) filename += ".docx";

  const dataBase64 = typeof body.dataBase64 === "string" ? body.dataBase64 : "";
  if (!dataBase64) {
    return NextResponse.json({ error: "Missing file data" }, { status: 400 });
  }

  const jobDescription =
    typeof body.jobDescription === "string" ? body.jobDescription : "";

  try {
    const dir = path.join(BASE_DIR, personName, folder);
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, filename);
    await fs.writeFile(filePath, Buffer.from(dataBase64, "base64"));

    let pdfPath: string | null = null;
    let pdfError: string | undefined;
    try {
      pdfPath = await convertDocxToPdf(filePath);
    } catch (err) {
      pdfError = err instanceof Error ? err.message : "PDF conversion failed";
    }

    // Keep only the PDF: once it is produced, the intermediate DOCX is removed.
    let docxPath: string | null = filePath;
    if (pdfPath) {
      try {
        await fs.unlink(filePath);
        docxPath = null;
      } catch {
        // If it can't be removed (e.g. still locked), leave it in place.
      }
    }

    // Save the job description next to the resume as a .txt file.
    let jdPath: string | null = null;
    if (jobDescription.trim()) {
      jdPath = path.join(dir, `${filename.replace(/\.docx$/i, "")} - JD.txt`);
      await fs.writeFile(jdPath, jobDescription, "utf8");
    }

    return NextResponse.json({
      ok: true,
      docxPath,
      pdfPath,
      pdfError,
      jdPath,
      // `path` = best file to point the user at (PDF if it was produced).
      path: pdfPath ?? docxPath ?? jdPath,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to save file";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
