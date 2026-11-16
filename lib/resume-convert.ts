/**
 * Turn an uploaded resume PDF into a profile .md in the exact format the
 * app expects (same layout as the files in resumes/).
 */
import OpenAI from "openai";

/** Extract a PDF's text, keeping line breaks (from the text positions). */
export async function pdfToText(data: Buffer): Promise<string> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(data));
  let out = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const { items } = await page.getTextContent();
    let lastY: number | null = null;
    for (const it of items) {
      if (!("str" in it)) continue;
      const y = it.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2 && !out.endsWith("\n")) out += "\n";
      out += it.str;
      if (it.hasEOL) out += "\n";
      lastY = y;
    }
    out += "\n\n";
  }
  return out
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

const FORMAT = `# FULL NAME IN UPPERCASE

<Phone> | <Email> | <City, Country> | <linkedin.com/in/...> | <github.com/...>

## PROFESSIONAL SUMMARY

<one paragraph>

## PROFESSIONAL EXPERIENCE

### <Job Title> | <Mon YYYY> - <Mon YYYY or Present>
**<Company>** | <Location>

- <bullet>
- <bullet>

### <next job, same layout>

## PROJECTS

### <Project name>
**<Company or context>** | <Location>

- <bullet>

## TECHNICAL SKILLS

**<Category>:** <skill>, <skill>, <skill>

**<Category>:** <skill>, <skill>

## EDUCATION

**<School>** | <Start> – <End>
<Degree, Field of study>

## LANGUAGES

- <Language> — <Level>
- <Language> — <Level>`;

const PROMPT = `You convert a resume (text extracted from a PDF) into Markdown.

Output ONLY the Markdown, in exactly this format:

${FORMAT}

Rules:
- Copy the content faithfully. Never invent, add or remove jobs, dates, companies, skills, schools, languages, links or contact details.
- Keep every bullet point and its wording. Only fix problems caused by PDF text extraction: broken lines, words split by hyphenation, stray page numbers, headers/footers, odd spacing.
- Contact line: only items that exist in the resume, separated by " | ". Write links without "https://" and "www." (e.g. linkedin.com/in/name). Leave out GitHub if the resume has none.
- Dates as 3-letter month + year (e.g. "Jan 2024 - Present"). Keep years-only dates as years.
- Leave out the PROJECTS section if the resume has no projects. Leave out any other section that doesn't exist, except keep the order above.
- Group skills under "**Category:**" lines like the format; keep the resume's own categories when it has them.
- Languages: copy names and levels exactly as written.
- No code fences, no comments, no text before or after the Markdown.`;

function apiKey(): string {
  const keys = (process.env.OPENAI_API_KEY || "")
    .split(/[\n,]+/)
    .map((k) => k.trim())
    .filter(Boolean);
  if (keys.length === 0) throw new Error("OPENAI_API_KEY is not configured");
  return keys[Math.floor(Math.random() * keys.length)];
}

export async function resumeTextToMarkdown(text: string): Promise<string> {
  if (text.length < 200) {
    throw new Error("Couldn't read enough text from this PDF (is it a scanned image?). Paste the resume as text instead.");
  }
  const client = new OpenAI({ apiKey: apiKey() });
  const res = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
    temperature: 0,
    messages: [
      { role: "system", content: PROMPT },
      { role: "user", content: text.slice(0, 60000) },
    ],
  });
  const md = (res.choices[0]?.message?.content ?? "")
    .replace(/^```(?:markdown|md)?\s*\n/i, "")
    .replace(/\n```\s*$/, "")
    .trim();
  if (!/^#\s+\S/m.test(md)) throw new Error("The AI didn't return a resume in the expected format. Try again.");
  return md;
}
