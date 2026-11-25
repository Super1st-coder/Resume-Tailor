import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import { JobLinkError, readJobPage } from "@/lib/job-link";
import { browserAvailable, readJobPageWithBrowser } from "@/lib/browser-read";
import { NotSignedIn, requireProfile } from "@/lib/session";

export const dynamic = "force-dynamic";

const MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
const MAX_PAGE_CHARS = 40000;

function pickKey(): string | null {
  const keys = (process.env.OPENAI_API_KEY ?? "").split(/[\n,]+/).map((k) => k.trim()).filter(Boolean);
  return keys.length ? keys[Math.floor(Math.random() * keys.length)] : null;
}

/**
 * POST { url } (signed-in candidate) → { company, role, jobDescription }.
 * Structured data from the page is used as is; the AI fills in whatever is missing
 * by analyzing the page text. Nothing is stored and nothing is counted.
 */
export async function POST(request: NextRequest) {
  try {
    await requireProfile(request);
  } catch (err) {
    return NextResponse.json({ error: err instanceof NotSignedIn ? err.message : "Please sign in" }, { status: 401 });
  }

  let url = "";
  let pasted = "";
  try {
    const body = await request.json();
    url = typeof body.url === "string" ? body.url.trim() : "";
    pasted = typeof body.text === "string" ? body.text.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!url && !pasted) return NextResponse.json({ error: "Paste a job link first" }, { status: 400 });

  // Pasted text: for sites that refuse automatic reading, the candidate copies the page
  // (Ctrl+A, Ctrl+C) into the job description box and the AI analyzes that text instead.
  let page: Awaited<ReturnType<typeof readJobPage>>;
  if (pasted) {
    page = { posting: {}, pageText: pasted, finalUrl: url || "(page text pasted by the user)" };
  } else {
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    try {
      try {
        page = await readJobPage(url);
      } catch (e) {
        // Blocked for plain readers: only then try a hidden browser on the server.
        if (!(e instanceof JobLinkError && e.blocked) || !browserAvailable()) throw e;
        console.log(`[job-link] blocked, trying browser: ${new URL(url).hostname}`);
        page = await readJobPageWithBrowser(url);
      }
    } catch (e) {
      const msg = e instanceof JobLinkError ? e.message : "Could not read the link";
      const blocked = e instanceof JobLinkError && e.blocked;
      return NextResponse.json({ error: msg, blocked }, { status: 422 });
    }
  }

  let company = page.posting.company?.trim() ?? "";
  let role = page.posting.role?.trim() ?? "";
  let jobDescription = page.posting.description?.trim() ?? "";
  const haveDescription = jobDescription.length >= 200;

  if (!company || !role || !haveDescription) {
    if (!page.pageText.trim()) {
      return NextResponse.json({ error: "The page has no readable text. Paste the job by hand." }, { status: 422 });
    }
    const key = pickKey();
    if (!key) return NextResponse.json({ error: "OPENAI_API_KEY is not configured" }, { status: 500 });

    const known = [
      company && `Company (already known): ${company}`,
      role && `Job title (already known): ${role}`,
    ].filter(Boolean).join("\n");
    const prompt = `You read a job posting web page and extract the posting.
Page address: ${page.finalUrl}
${known}

Return JSON: {"company": string, "role": string, "jobDescription": string, "isJobPosting": boolean}
- company: the hiring company's name (not the job board, e.g. not "LinkedIn", "Indeed", "Greenhouse", "Lever", "Workday"). Short name, no "Inc."/"LLC" unless it's part of how the company is known.
- role: the job title exactly as posted.
- jobDescription: ${
      haveDescription
        ? 'return "" (the description is already known).'
        : "the full job description copied from the page text: start with the location line and the intro paragraph(s) right after the job title, then about the role, responsibilities, requirements/qualifications, nice-to-haves, benefits, salary. Don't drop any paragraph of the posting itself. Copy the wording; don't summarize or rewrite. Keep headings and put each bullet on its own line starting with \"- \". Leave out site navigation, cookie notices, other job listings, sign-in prompts and footers."
    }
- isJobPosting: false if the page is not a single job posting (e.g. a login wall, error page or list of jobs).
Use "" for anything that isn't on the page. Never invent.

PAGE TEXT:
${page.pageText.slice(0, MAX_PAGE_CHARS)}`;

    try {
      const client = new OpenAI({ apiKey: key });
      const res = await client.chat.completions.create({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0,
      });
      const out = JSON.parse(res.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
      const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
      if (out.isJobPosting === false && !haveDescription && !s(out.jobDescription)) {
        return NextResponse.json(
          { error: "No job posting found on that page (it may need a sign-in). Paste the job by hand." },
          { status: 422 }
        );
      }
      company = company || s(out.company);
      role = role || s(out.role);
      if (!haveDescription) jobDescription = s(out.jobDescription) || jobDescription;
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "AI request failed" }, { status: 502 });
    }
  }

  if (!company && !role && !jobDescription) {
    return NextResponse.json({ error: "Nothing could be read from that page. Paste the job by hand." }, { status: 422 });
  }
  return NextResponse.json({ company, role, jobDescription });
}
