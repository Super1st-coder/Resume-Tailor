import { promises as dns } from "dns";
import http from "http";
import https from "https";
import net from "net";
import zlib from "zlib";

/**
 * Fetch a job posting page and pull out company, role and description.
 *
 * Order of sources (best first):
 *   1. Site APIs for pages that are rendered by JavaScript (LinkedIn, Workday, Greenhouse, Lever, Ashby).
 *   2. schema.org JobPosting JSON-LD embedded in the page (most career sites have it).
 *   3. The page's visible text, for the AI to analyze.
 *
 * Only public http(s) addresses are fetched: private, loopback and link-local
 * IPs are refused (also after redirects), so the server can't be used to reach
 * its own network.
 */

export type JobPosting = { company: string; role: string; description: string };
export type JobPage = { posting: Partial<JobPosting>; pageText: string; finalUrl: string };

export class JobLinkError extends Error {
  /** true: the site refuses automatic readers; the page text has to be pasted instead. */
  constructor(message: string, readonly blocked = false) {
    super(message);
  }
}

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 15000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") ||
    v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
}

/** Check the link and return one public IP for it (the request is then pinned to that IP). */
export async function resolvePublic(u: URL): Promise<{ address: string; family: number }> {
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new JobLinkError("Only http(s) links are supported");
  if (u.username || u.password) throw new JobLinkError("Links with a username or password are not supported");
  const host = u.hostname.replace(/^[|]$/g, "");
  const addrs = net.isIP(host)
    ? [{ address: host, family: net.isIP(host) }]
    : await dns.lookup(host, { all: true }).catch(() => []);
  if (addrs.length === 0) throw new JobLinkError(`Could not find the site ${u.hostname}`);
  if (addrs.some((a) => isPrivateIp(a.address))) throw new JobLinkError("This address is not allowed");
  return addrs[0];
}

type RawResponse = { status: number; location: string | null; body: Buffer };

/**
 * One HTTP request with Node's http/https client (some job sites, e.g. Workday,
 * refuse Node's built-in fetch). The connection goes to the IP checked above.
 */
function requestOnce(
  u: URL,
  ip: { address: string; family: number },
  init: { method?: string; body?: string; accept?: string }
): Promise<RawResponse> {
  const lib = u.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      u,
      {
        method: init.method ?? "GET",
        timeout: TIMEOUT_MS,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        lookup: ((_h: string, opts: { all?: boolean }, cb: (...a: any[]) => void) =>
          opts?.all ? cb(null, [ip]) : cb(null, ip.address, ip.family)) as unknown as net.LookupFunction,
        headers: {
          "User-Agent": UA,
          Accept: init.accept ?? "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          ...(init.body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(init.body) } : {}),
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === "string" ? res.headers.location : null;
        if (status >= 300 && status < 400 && location) {
          res.resume();
          return resolve({ status, location, body: Buffer.alloc(0) });
        }
        const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
        const stream: NodeJS.ReadableStream =
          enc === "gzip" ? res.pipe(zlib.createGunzip())
          : enc === "deflate" ? res.pipe(zlib.createInflate())
          : enc === "br" ? res.pipe(zlib.createBrotliDecompress())
          : res;
        const chunks: Buffer[] = [];
        let size = 0;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve({ status, location: null, body: Buffer.concat(chunks) });
        };
        stream.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_BYTES) {
            finish();
            req.destroy();
            return;
          }
          chunks.push(c);
        });
        stream.on("end", finish);
        stream.on("error", (e) => (done ? undefined : reject(e)));
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

/** Request a public URL, following redirects manually so each hop is checked. */
async function fetchPublic(
  url: string,
  init: { method?: string; body?: string; accept?: string } = {}
): Promise<{ text: string; finalUrl: string; status: number }> {
  let current = new URL(url);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const ip = await resolvePublic(current);
    const res = await requestOnce(current, ip, init);
    if (res.location) {
      current = new URL(res.location, current);
      continue;
    }
    return { text: res.body.toString("utf8"), finalUrl: current.toString(), status: res.status };
  }
  throw new JobLinkError("Too many redirects");
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", hellip: "…", bull: "•", middot: "·", trade: "™", reg: "®", copy: "©",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** HTML → readable plain text with line breaks and "- " bullets. */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|section|article|ul|ol|li|h[1-6]|tr|table|header|footer|main)>/gi, "\n")
    .replace(/<(p|div|section|article|ul|ol|h[1-6]|tr|table)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  return s
    .replace(/\r/g, "")
    .replace(/[ \t ]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n(- )?\n/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Description may be HTML, or HTML escaped as entities (some sites double-encode). */
function descToText(d: unknown): string {
  if (typeof d !== "string") return "";
  let s = d;
  if (!/<[a-z]/i.test(s) && /&lt;[a-z]/i.test(s)) s = decodeEntities(s);
  return htmlToText(s);
}

function str(v: unknown): string {
  return typeof v === "string" ? decodeEntities(v).trim() : "";
}

/** Find a schema.org JobPosting in the page's JSON-LD blocks. */
export function fromJsonLd(html: string): Partial<JobPosting> {
  const blocks = html.match(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  for (const block of blocks) {
    const raw = block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    const stack: unknown[] = [data];
    while (stack.length) {
      const node = stack.pop();
      if (Array.isArray(node)) {
        stack.push(...node);
        continue;
      }
      if (!node || typeof node !== "object") continue;
      const o = node as Record<string, unknown>;
      const type = o["@type"];
      if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) {
        const org = o.hiringOrganization;
        const company = typeof org === "string" ? str(org) : str((org as Record<string, unknown> | undefined)?.name);
        return { company, role: str(o.title), description: descToText(o.description) };
      }
      if (o["@graph"]) stack.push(o["@graph"]);
    }
  }
  return {};
}

export function metaContent(html: string, key: string): string {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`,
    "i"
  );
  const m = html.match(re);
  return m ? decodeEntities(m[1] ?? m[2] ?? "").trim() : "";
}

async function getJson(url: string, init?: { method?: string; body?: string }): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetchPublic(url, { ...init, accept: "application/json" });
    if (r.status !== 200) return null;
    return JSON.parse(r.text);
  } catch {
    return null;
  }
}

/** Sites that render the job with JavaScript: read their public job APIs instead. */
async function fromSiteApi(u: URL): Promise<{ posting: Partial<JobPosting>; text?: string } | null> {
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);

  // LinkedIn: /jobs/view/<slug>-<id> or ?currentJobId=<id>
  if (host.endsWith("linkedin.com")) {
    const id = u.searchParams.get("currentJobId") ?? u.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/)?.[1];
    if (!id) return null;
    // LinkedIn often answers 429 (rate limit) at first: retry a few times.
    let r: Awaited<ReturnType<typeof fetchPublic>> | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt) await new Promise((ok) => setTimeout(ok, 1200 * attempt));
      r = await fetchPublic(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`).catch(() => null);
      if (r && r.status !== 429) break;
    }
    if (!r || r.status !== 200) return null;
    const role = htmlToText(r.text.match(/<h2[^>]*top-card-layout__title[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? "");
    const company = htmlToText(r.text.match(/<a[^>]*topcard__org-name-link[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "");
    const descHtml = r.text.match(/<div[^>]*show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "";
    return { posting: { company, role, description: htmlToText(descHtml) }, text: htmlToText(r.text) };
  }

  // Workday: <tenant>.wdN.myworkdayjobs.com/[lang/]<site>/job/<location>/<slug>
  if (host.endsWith(".myworkdayjobs.com")) {
    const tenant = host.split(".")[0];
    const jobIdx = parts.indexOf("job");
    if (jobIdx < 1) return null;
    const site = parts[jobIdx - 1];
    const j = await getJson(`https://${host}/wday/cxs/${tenant}/${site}/${parts.slice(jobIdx).join("/")}`);
    const info = j?.jobPostingInfo as Record<string, unknown> | undefined;
    if (!info) return null;
    // hiringOrganization is often a legal entity ("IN01 NVIDIA Graphics Bengaluru"): give it to the AI as a hint.
    const entity = str((j?.hiringOrganization as Record<string, unknown> | undefined)?.name);
    const description = descToText(info.jobDescription);
    return {
      posting: { role: str(info.title), description },
      text: [`Workday career site of: ${tenant}`, entity && `Hiring legal entity: ${entity}`, description.slice(0, 3000)]
        .filter(Boolean)
        .join("\n\n"),
    };
  }

  // Greenhouse: boards.greenhouse.io/<board>/jobs/<id>, job-boards.greenhouse.io/<board>/jobs/<id>, or ?gh_jid=<id>
  if (host.endsWith("greenhouse.io") && parts.length >= 3 && parts[1] === "jobs") {
    const j = await getJson(`https://boards-api.greenhouse.io/v1/boards/${parts[0]}/jobs/${parts[2]}`);
    if (!j) return null;
    return { posting: { company: str(j.company_name), role: str(j.title), description: descToText(j.content) } };
  }

  // Lever: jobs.lever.co/<company>/<id>
  if (host === "jobs.lever.co" && parts.length >= 2) {
    const j = await getJson(`https://api.lever.co/v0/postings/${parts[0]}/${parts[1]}`);
    if (!j) return null;
    const lists = Array.isArray(j.lists)
      ? (j.lists as { text?: string; content?: string }[])
          .map((l) => `${str(l.text)}\n${htmlToText(l.content ?? "")}`)
          .join("\n\n")
      : "";
    const desc = [str(j.descriptionPlain) || descToText(j.description), lists, str(j.additionalPlain)]
      .filter(Boolean)
      .join("\n\n");
    return { posting: { role: str(j.text), description: desc } };
  }

  // Ashby: jobs.ashbyhq.com/<company>/<job id>
  if (host === "jobs.ashbyhq.com" && parts.length >= 2) {
    const j = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${parts[0]}?includeCompensation=false`);
    const jobs = Array.isArray(j?.jobs) ? (j!.jobs as Record<string, unknown>[]) : [];
    const job = jobs.find((x) => x.id === parts[1]);
    if (!job) return null;
    return { posting: { role: str(job.title), description: str(job.descriptionPlain) || descToText(job.descriptionHtml) } };
  }
  return null;
}

/** Fetch the link and return whatever structured data and text can be found. */
export async function readJobPage(link: string): Promise<JobPage> {
  let u: URL;
  try {
    u = new URL(link.trim());
  } catch {
    throw new JobLinkError("That doesn't look like a link. Paste the full address, starting with https://");
  }

  const api = await fromSiteApi(u).catch(() => null);
  if (api?.posting.description && api.posting.role && api.posting.company) {
    return { posting: api.posting, pageText: api.text ?? "", finalUrl: u.toString() };
  }

  let page: { text: string; finalUrl: string; status: number };
  try {
    page = await fetchPublic(u.toString());
  } catch (e) {
    if (e instanceof JobLinkError) throw e;
    throw new JobLinkError("Could not open the link (the site did not answer)");
  }
  if (page.status === 404 || page.status === 410) {
    throw new JobLinkError(`Job page not found (HTTP ${page.status}). The posting may have been closed.`);
  }
  // Other 4xx (400, 401, 403, 429, LinkedIn's 999...): the site refuses non-browser readers (e.g. Meta, Vercel sites).
  if (page.status >= 400 && page.status < 500 || page.status === 999) {
    throw new JobLinkError(`This site doesn't allow automatic reading (HTTP ${page.status}).`, true);
  }
  if (page.status >= 500) throw new JobLinkError(`The job site had an error (HTTP ${page.status}). Try again later.`);

  const ld = fromJsonLd(page.text);
  const posting: Partial<JobPosting> = {
    company: api?.posting.company || ld.company || "",
    role: api?.posting.role || ld.role || "",
    description: api?.posting.description || ld.description || "",
  };
  const title = metaContent(page.text, "og:title") || htmlToText(page.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const metaDesc = metaContent(page.text, "og:description") || metaContent(page.text, "description");
  const body = page.text.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? page.text;
  const site = metaContent(page.text, "og:site_name");
  const pageText = [api?.text, site && `Site name: ${site}`, title && `Page title: ${title}`, metaDesc && `Page summary: ${metaDesc}`, htmlToText(body)]
    .filter(Boolean)
    .join("\n\n");
  return { posting, pageText, finalUrl: page.finalUrl };
}
