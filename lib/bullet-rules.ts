/**
 * Bullet rules for the first three work-experience roles of a generated resume:
 *
 *   1st role: more than 9 bullets, 60% one-line and 40% two-line
 *   2nd role: more than 6 bullets, 40% one-line and 60% two-line
 *   3rd role: more than 6 bullets, 30% one-line and 70% two-line
 *
 * The AI is told these rules in the prompt but often ignores them, so after
 * generation each role is checked here. A role that breaks the rules is rewritten
 * by a second, small AI request with an exact plan (which bullet is one line and
 * which is two), up to two tries; the better result is kept.
 *
 * Line length is estimated from the text length (without ** markup). On the resume
 * page one printed bullet line holds about 95-100 characters.
 */

export const ROLE_RULES = [
  { min: 10, max: 12, oneLineShare: 0.6 },
  { min: 7, max: 9, oneLineShare: 0.4 },
  { min: 7, max: 9, oneLineShare: 0.3 },
] as const;

/** Up to this many characters a bullet fits on one printed line. */
const ONE_LINE_MAX = 95;
/** Above this a bullet needs a third line. */
const TWO_LINE_MAX = 190;

export type LineKind = 1 | 2 | 3;

const plain = (bullet: string) =>
  bullet
    .replace(/^\s*[-*]\s+/, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();

export function lineKind(bullet: string): LineKind {
  const n = plain(bullet).length;
  return n <= ONE_LINE_MAX ? 1 : n <= TWO_LINE_MAX ? 2 : 3;
}

/** The planned order of one-line (1) and two-line (2) bullets for a role. */
export function bulletPlan(count: number, oneLineShare: number): LineKind[] {
  const ones = Math.round(count * oneLineShare);
  const twos = count - ones;
  // Spread the two-line bullets evenly, starting with one (the strongest point first).
  const plan: LineKind[] = Array(count).fill(1);
  for (let k = 0; k < twos; k++) plan[Math.min(count - 1, Math.floor((k * count) / twos))] = 2;
  return plan;
}

type Role = {
  /** Line index (in the whole resume) of the "### " job heading. */
  headingLine: number;
  /** Line indexes of the job's bullets. */
  bulletLines: number[];
};

/** The work-experience jobs of a resume, in order. */
function experienceRoles(lines: string[]): Role[] {
  const roles: Role[] = [];
  let inExp = false;
  lines.forEach((line, i) => {
    const h2 = line.match(/^##\s+(.*)$/);
    if (h2) {
      inExp = /experience|employment|work history/i.test(h2[1].replace(/[*_]/g, ""));
      return;
    }
    if (!inExp) return;
    if (/^###\s+/.test(line)) roles.push({ headingLine: i, bulletLines: [] });
    else if (roles.length && /^\s*[-*]\s+/.test(line)) roles[roles.length - 1].bulletLines.push(i);
  });
  return roles;
}

/** How far a role's bullets are from the rule (0 = follows it). */
export function ruleMisses(bullets: string[], rule: (typeof ROLE_RULES)[number]): number {
  const kinds = bullets.map(lineKind);
  const count = bullets.length;
  let misses = 0;
  if (count < rule.min) misses += (rule.min - count) * 2;
  if (count > rule.max) misses += count - rule.max;
  const ones = kinds.filter((k) => k === 1).length;
  misses += Math.abs(ones - Math.round(count * rule.oneLineShare));
  misses += kinds.filter((k) => k === 3).length;
  return misses;
}

export type AskAi = (message: string) => Promise<string>;

function rewritePrompt(roleText: string, ones: number, twos: number, jd: string): string {
  return `Rewrite the bullets of this resume job as two lists: ${twos} LONG bullets and ${ones} SHORT bullets.

LONG bullets (exactly ${twos}), write these first:
- Each is 18-22 words, 120-160 characters (never more than 165): what was built, with which technologies, and the outcome.
- One sentence, at most two commas.

SHORT bullets (exactly ${ones}), write these second:
- Each is 8-12 words and at most 85 characters, e.g. "- Built **Kafka** consumers for real-time payment events across services."
- One concrete action with one or two technologies. No "while", "ensuring", "enhancing" tails.
- Each SHORT bullet covers work NOT already in a LONG bullet: a different task and a different main technology
  (e.g. testing, monitoring, caching, documentation, code reviews, security, data migration, on-call, a JD skill).

Rules:
- Every bullet is a different achievement. Never say the same thing twice in different words.
- Keep the facts, technologies, tone and tense of the current bullets. Keep **bold** on key technologies.
- To reach the counts, split bullets or add bullets about this same job using skills from the job description below.
- Never invent employers, numbers, certifications or titles.
- Output exactly this format and nothing else:
LONG:
- ...
SHORT:
- ...

=== CURRENT JOB ===
${roleText}

=== JOB DESCRIPTION (for skills) ===
${jd.slice(0, 4000)}`;
}

/** Parse the "SHORT: / LONG:" answer and mix the two lists in the planned order. */
function mixByPlan(out: string, plan: LineKind[]): string[] {
  const short: string[] = [];
  const long: string[] = [];
  let list: string[] | null = null;
  for (const raw of out.split("\n")) {
    const l = raw.trim().replace(/^\*\*|\*\*$/g, "");
    if (/^short\b/i.test(l)) list = short;
    else if (/^long\b/i.test(l)) list = long;
    else if (list && /^[-*•]\s+/.test(l)) list.push("- " + l.replace(/^[-*•]\s+/, ""));
  }
  // A "short" bullet that came out long goes with the long ones, and vice versa.
  const all = [...short, ...long];
  const ones = all.filter((b) => lineKind(b) === 1);
  const others = all.filter((b) => lineKind(b) !== 1);
  const mixed: string[] = [];
  for (const k of plan) {
    const from = k === 1 ? (ones.length ? ones : others) : others.length ? others : ones;
    if (from.length) mixed.push(from.shift()!);
  }
  return mixed;
}

/** Rewrite one role's bullets if they break its rule; null when they're fine or the AI failed. */
async function fixRole(roleText: string, bullets: string[], r: number, jd: string, ask: AskAi): Promise<string[] | null> {
  const rule = ROLE_RULES[r];
  if (!bullets.length || ruleMisses(bullets, rule) === 0) return null;
  const count = Math.min(rule.max, Math.max(rule.min, bullets.length));
  const plan = bulletPlan(count, rule.oneLineShare);
  const ones = plan.filter((k) => k === 1).length;

  let best: string[] | null = null;
  let bestMisses = ruleMisses(bullets, rule);
  for (let attempt = 0; attempt < 2 && bestMisses > 0; attempt++) {
    try {
      const out = await ask(rewritePrompt(roleText, ones, plan.length - ones, jd));
      const fixed = mixByPlan(out, plan);
      if (fixed.length < rule.min) continue;
      const misses = ruleMisses(fixed, rule);
      if (misses < bestMisses) {
        best = fixed;
        bestMisses = misses;
      }
    } catch {
      break;
    }
  }
  return best;
}

/**
 * Checks the bullet rules while the resume is still being written: as soon as one of
 * the first three roles is complete (the next role or section has started), its
 * check/rewrite starts in the background. finish() waits for them and applies the
 * results, so the extra AI requests mostly overlap the main generation.
 */
export class BulletRuleFixer {
  private started: Promise<string[] | null>[] = [];
  private jd: string;
  private ask: AskAi;

  constructor(jd: string, ask: AskAi) {
    this.jd = jd;
    this.ask = ask;
  }

  /** Call with the resume text received so far (it only grows). */
  feed(md: string): void {
    if (this.started.length >= ROLE_RULES.length) return;
    const lines = md.split("\n");
    // Ignore the last line: it may still be incomplete.
    const complete = lines.slice(0, -1);
    const roles = experienceRoles(complete);
    // A role is complete when a later "###" or "##" line exists after its bullets.
    const lastBoundary = complete.reduce((acc, l, i) => (/^#{2,3}\s+/.test(l) ? i : acc), -1);
    while (this.started.length < ROLE_RULES.length) {
      const r = this.started.length;
      const role = roles[r];
      if (!role || !role.bulletLines.length || lastBoundary <= role.bulletLines[role.bulletLines.length - 1]) break;
      this.start(complete, role, r);
    }
  }

  private start(lines: string[], role: Role, r: number) {
    const bullets = role.bulletLines.map((i) => lines[i]);
    const end = role.bulletLines[role.bulletLines.length - 1];
    const roleText = lines.slice(role.headingLine, end + 1).join("\n");
    this.started.push(fixRole(roleText, bullets, r, this.jd, this.ask).catch(() => null));
  }

  /** Wait for the checks (starting any not started yet) and return the fixed resume. */
  async finish(md: string): Promise<string> {
    const lines = md.split("\n");
    const roles = experienceRoles(lines).slice(0, ROLE_RULES.length);
    for (let r = this.started.length; r < roles.length; r++) this.start(lines, roles[r], r);
    const fixes = await Promise.all(this.started);

    // Replace each fixed role's bullets (at the place of its first bullet).
    const replace = new Map<number, string[]>();
    const drop = new Set<number>();
    fixes.forEach((fixed, r) => {
      const role = roles[r];
      if (!fixed || !role || !role.bulletLines.length) return;
      const [first, ...rest] = role.bulletLines;
      replace.set(first, fixed);
      rest.forEach((i) => drop.add(i));
    });
    if (!replace.size) return md;
    return lines
      .flatMap((line, i) => (replace.has(i) ? replace.get(i)! : drop.has(i) ? [] : [line]))
      .join("\n");
  }
}

/** Check the first three roles of a finished resume and rewrite the ones that break the rules. */
export function applyBulletRules(md: string, jd: string, ask: AskAi): Promise<string> {
  return new BulletRuleFixer(jd, ask).finish(md);
}
