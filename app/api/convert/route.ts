import { NextRequest, NextResponse } from "next/server";
import { promises as fs, existsSync } from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { exec, execFile } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

/**
 * Convert a .docx to .pdf with the installed MS Word (COM automation).
 * Gives the same output as Word's own "Save as PDF".
 */
async function convertWithWord(docxPath: string, pdfPath: string): Promise<void> {
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
  await execAsync(`powershell -NoProfile -NonInteractive -Command "${script}"`, {
    timeout: 120000,
    windowsHide: true,
  });
}

/** LibreOffice's soffice: SOFFICE_PATH if set, else the usual install locations. */
function findSoffice(): string | null {
  const candidates = [
    process.env.SOFFICE_PATH,
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
    "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
    "/usr/bin/soffice",
    "/usr/bin/libreoffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  ];
  return candidates.find((c): c is string => !!c && existsSync(c)) ?? null;
}

/**
 * Convert with LibreOffice (headless). Each call gets its own temporary
 * profile so several conversions can run at once without locking each other.
 */
async function convertWithLibreOffice(soffice: string, docxPath: string, dir: string): Promise<void> {
  const profileUrl = "file:///" + path.join(dir, "lo-profile").replace(/\\/g, "/").replace(/^\/+/, "");
  await execFileAsync(
    soffice,
    [
      `-env:UserInstallation=${profileUrl}`,
      "--headless",
      "--norestore",
      "--nolockcheck",
      "--convert-to",
      "pdf",
      "--outdir",
      dir,
      docxPath,
    ],
    { timeout: 120000, windowsHide: true }
  );
}

/** Whether MS Word is registered on this machine (checked once). */
let wordAvailable: boolean | null = null;
async function hasWord(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  if (wordAvailable === null) {
    try {
      await execAsync('reg query "HKCR\\Word.Application"', { windowsHide: true });
      wordAvailable = true;
    } catch {
      wordAvailable = false;
    }
  }
  return wordAvailable;
}

/** Use MS Word if installed, otherwise LibreOffice. */
async function convertDocxToPdf(docxPath: string, pdfPath: string, dir: string): Promise<void> {
  if (await hasWord()) {
    await convertWithWord(docxPath, pdfPath);
    return;
  }
  const soffice = findSoffice();
  if (!soffice) {
    throw new Error("No PDF converter on the server: install LibreOffice (or MS Word).");
  }
  await convertWithLibreOffice(soffice, docxPath, dir);
  if (!existsSync(pdfPath)) throw new Error("LibreOffice did not produce a PDF");
}

/**
 * POST { dataBase64 } (a DOCX) -> { pdfBase64 } or { pdfError }.
 * Nothing is kept on the server: the files live in a temp folder that is
 * deleted before the response is sent. The browser saves the result on the
 * user's own PC.
 */
export async function POST(request: NextRequest) {
  let body: { dataBase64?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const dataBase64 = typeof body.dataBase64 === "string" ? body.dataBase64 : "";
  if (!dataBase64) {
    return NextResponse.json({ error: "Missing file data" }, { status: 400 });
  }

  const dir = path.join(os.tmpdir(), `resume-tailor-${randomUUID()}`);
  try {
    await fs.mkdir(dir, { recursive: true });
    const docxPath = path.join(dir, "resume.docx");
    const pdfPath = path.join(dir, "resume.pdf");
    await fs.writeFile(docxPath, Buffer.from(dataBase64, "base64"));
    await convertDocxToPdf(docxPath, pdfPath, dir);
    const pdf = await fs.readFile(pdfPath);
    return NextResponse.json({ pdfBase64: pdf.toString("base64") });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "PDF conversion failed";
    return NextResponse.json({ pdfError: msg });
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
