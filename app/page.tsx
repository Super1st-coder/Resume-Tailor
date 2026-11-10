"use client";

import { useEffect, useState } from "react";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ExternalHyperlink,
  ImageRun,
  HeadingLevel,
  LevelFormat,
  BorderStyle,
  sectionPageSizeDefaults,
} from "docx";
import {
  classifyContactPart,
  contactIconPng,
  contactIconSvg,
} from "@/lib/contact-icons";

type ParagraphChild = TextRun | ExternalHyperlink | ImageRun;

type ChatResponse = {
  content: string;
  reasoning_details?: unknown;
  role?: string;
  finish_reason?: string;
};

const RUN_OPTS = { noProof: true } as const;

/** Extra run formatting applied to every run of a line (e.g. gray contact line). */
type RunExtra = { color?: string; size?: number; bold?: boolean };

function parseInlineToRuns(text: string, extra: RunExtra = {}): TextRun[] {
  const runs: TextRun[] = [];
  const R = { ...RUN_OPTS, ...extra };
  if (!text.length) return [new TextRun({ text: "", ...R })];

  const re = /\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|_([^_\n]+)_|`([^`\n]+)`/g;
  let lastEnd = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > lastEnd) {
      runs.push(new TextRun({ text: text.slice(lastEnd, m.index), ...R }));
    }

    if (m[1] !== undefined || m[2] !== undefined) {
      runs.push(new TextRun({ text: (m[1] ?? m[2])!, ...R, bold: true }));
    } else if (m[3] !== undefined || m[4] !== undefined) {
      runs.push(new TextRun({ text: (m[3] ?? m[4])!, italics: true, ...R }));
    } else if (m[5] !== undefined) {
      runs.push(new TextRun({ text: m[5], ...R }));
    }

    lastEnd = re.lastIndex;
  }

  if (lastEnd < text.length) {
    runs.push(new TextRun({ text: text.slice(lastEnd), ...R }));
  }

  return runs.length ? runs : [new TextRun({ text, ...R })];
}

function parseInlineToParagraphChildren(
  text: string,
  extra: RunExtra = {}
): ParagraphChild[] {
  if (!text.length) return [new TextRun({ text: "", ...RUN_OPTS, ...extra })];

  const result: ParagraphChild[] = [];
  const linkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
  let lastEnd = 0;
  let m: RegExpExecArray | null;

  while ((m = linkRe.exec(text)) !== null) {
    if (m.index > lastEnd) {
      result.push(...parseInlineToRuns(text.slice(lastEnd, m.index), extra));
    }

    const linkText = m[1];
    let url = m[2].trim();

    if (url && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
      url = "https://" + url;
    }

    result.push(
      new ExternalHyperlink({
        children: [
          new TextRun({
            text: linkText,
            style: "Hyperlink",
            ...RUN_OPTS,
            ...(extra.size ? { size: extra.size } : {}),
          }),
        ],
        link: url || "#",
      })
    );

    lastEnd = linkRe.lastIndex;
  }

  if (lastEnd < text.length) {
    result.push(...parseInlineToRuns(text.slice(lastEnd), extra));
  }

  return result.length ? result : [new TextRun({ text, ...RUN_OPTS, ...extra })];
}

const isBulletLine = (s: string) => /^\s*[-*]\s+/.test(s);
const isOrderedLine = (s: string) => /^\s*\d+\.\s+/.test(s);
const isHeadingLine = (s: string) => /^#{1,6}\s+/.test(s);
/** Whole trimmed line is a single bold span, e.g. "**Company — Senior Engineer**". */
const isEntirelyBoldLine = (s: string) => /^\*\*[^*]+\*\*$/.test(s.trim());

/** Template-specific rendering choices (the parts DocxStyleConfig doesn't cover). */
export type RenderOptions = {
  /** How section (##) headings and the name (#) are cased. */
  headingCase: "upper" | "title";
  /** Where the section-heading rule line goes (if the Underline setting is on). */
  headingRule: "below" | "above";
  ruleColor: string;
  /** Optional color for the name and section headings, e.g. "1F3864". */
  accentColor?: string;
  bulletChar: string;
  bulletIndent: { left: number; hanging: number };
  bulletSpacingAfterPt: number;
  /** Skills as compact label lines, or as bullets. */
  skillsLayout: "lines" | "bullets";
  /** Bold the category label ("**Frontend:** React") or the skills ("Frontend: **React**"). */
  skillsEmphasis: "label" | "skills";
  /** Size of an all-bold line under the name (the job-title subtitle). */
  subtitleSizePt?: number;
  /** Color of the contact line under the name, e.g. "595959" (gray). */
  contactColor?: string;
};

const CLASSIC_RENDER: RenderOptions = {
  headingCase: "upper",
  headingRule: "below",
  ruleColor: "000000",
  bulletChar: "⁃",
  bulletIndent: { left: 360, hanging: 180 },
  bulletSpacingAfterPt: 0,
  skillsLayout: "lines",
  skillsEmphasis: "label",
};

const SMALL_WORDS = new Set(["and", "or", "of", "the", "a", "an", "in", "on", "for", "to", "at", "by", "with"]);

/** "PROFESSIONAL EXPERIENCE" -> "Professional Experience" (keeps short words lowercase). */
function toTitleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/(\s+)/)
    .map((w, i) =>
      /^\s+$/.test(w) || (i > 0 && SMALL_WORDS.has(w))
        ? w
        : w.replace(/(^|[-/&(])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase())
    )
    .join("");
}

/** A skills line with the skills bold and the label plain: "Frontend: **React**, **Next.js**". */
function skillLineWithBoldSkills(text: string): ParagraphChild[] {
  const plain = text.replace(/\*\*|__/g, "");
  const m = plain.match(/^([^:]{1,60}):\s*(.*)$/);
  if (!m) return parseInlineToParagraphChildren(text);
  const items = m[2].split(/,\s*/).filter(Boolean);
  const runs: TextRun[] = [new TextRun({ text: `${m[1]}: `, ...RUN_OPTS })];
  items.forEach((item, idx) => {
    runs.push(new TextRun({ text: item, bold: true, ...RUN_OPTS }));
    if (idx < items.length - 1) runs.push(new TextRun({ text: ", ", ...RUN_OPTS }));
  });
  return runs;
}

/**
 * Contact line under the name ("+41 ... | a@b.com | City | linkedin.com/in/x"):
 * put a small phone / email / location / LinkedIn icon before each part.
 * Returns null when the line doesn't look like contact info.
 */
function contactLineWithIcons(
  line: string,
  extra: RunExtra,
  iconColor: string,
  iconPx: number
): ParagraphChild[] | null {
  const parts = line.split("|").map((p) => p.trim()).filter(Boolean);
  const kinds = parts.map(classifyContactPart);
  if (kinds.filter(Boolean).length < 2) return null;

  const size = { width: iconPx, height: iconPx };
  const out: ParagraphChild[] = [];
  parts.forEach((part, i) => {
    if (i > 0) out.push(new TextRun({ text: "     ", ...RUN_OPTS, ...extra }));
    const kind = kinds[i];
    if (kind) {
      out.push(
        new ImageRun({
          type: "svg",
          // docx treats string data as base64, so pass the SVG markup as bytes.
          data: new TextEncoder().encode(contactIconSvg(kind, iconColor)),
          transformation: size,
          fallback: { type: "png", data: contactIconPng(kind) },
        })
      );
      out.push(new TextRun({ text: " ", ...RUN_OPTS, ...extra }));
    }
    // Make a plain "linkedin.com/in/..." clickable (https:// is added when missing).
    const text =
      kind === "linkedin" && !/\]\(/.test(part) ? `[${part}](${part})` : part;
    out.push(...parseInlineToParagraphChildren(text, extra));
  });
  return out;
}

function markdownToParagraphs(
  md: string,
  render: RenderOptions = CLASSIC_RENDER,
  bodyFontPt = 11
): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  // Keep only non-empty lines so we can look ahead to the next real line.
  const rows = md
    .split(/\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "");

  // The contact header sits between the name (H1) and the first H2; center it.
  let inHeaderZone = true;

  // The Technical Skills section is a set of label lines (no bullets); keep the
  // whole section together on one page.
  let inSkillsSection = false;

  // Each company/section starts a fresh numbered-list instance so its bullets
  // restart at 1 (otherwise Word keeps counting across companies).
  let listInstance = 0;

  // Count bullets since the last company/section header. The first few bullets
  // are kept on the same page as the header so a job never starts at the bottom
  // of a page with only its company name; it moves to the next page with a
  // meaningful portion of its content.
  let bulletsInBlock = 0;
  const KEEP_FIRST_BULLETS = 3;

  // Technical Skills uses a looser rule: keep only the heading + first couple of
  // label lines together so it can start in leftover space and split, instead of
  // being forced wholesale onto the next page (which leaves big blank gaps).
  const KEEP_FIRST_SKILL_LINES = 2;

  // True if line `idx` is a header/metadata line (company, title, dates) that
  // leads into a job's bullets before the next section heading. Such lines get
  // "keep with next" so the whole job header block stays together and moves to
  // the next page as a unit if it doesn't fit at the bottom.
  const leadsIntoBullets = (idx: number): boolean => {
    for (let j = idx + 1; j < rows.length; j++) {
      if (isHeadingLine(rows[j])) return false;
      if (isBulletLine(rows[j]) || isOrderedLine(rows[j])) return true;
    }
    return false;
  };

  for (let i = 0; i < rows.length; i++) {
    const trimmed = rows[i];

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);

    if (headingMatch) {
      const level = headingMatch[1].length;

      if (level >= 2) inHeaderZone = false;
      // New heading (section/company) => restart any following numbered list.
      listInstance++;
      bulletsInBlock = 0;
      let content = headingMatch[2].trim();

      if (level <= 2) {
        const plain = content.replace(/\*\*|__/g, "");
        if (render.headingCase === "title") content = toTitleCase(plain);
        else if (level === 2) content = content.toUpperCase();
      }

      // Track whether we just entered the (Technical) Skills section.
      inSkillsSection = level === 2 && /SKILL/i.test(content);

      const headingLevel =
        level === 1
          ? HeadingLevel.HEADING_1
          : level === 2
            ? HeadingLevel.HEADING_2
            : level === 3
              ? HeadingLevel.HEADING_3
              : level === 4
                ? HeadingLevel.HEADING_4
                : level === 5
                  ? HeadingLevel.HEADING_5
                  : HeadingLevel.HEADING_6;

      const opts: {
        children: ParagraphChild[];
        heading: (typeof HeadingLevel)[keyof typeof HeadingLevel];
        alignment?: "center";
        keepNext?: boolean;
        keepLines?: boolean;
      } = {
        children: parseInlineToParagraphChildren(content),
        heading: headingLevel,
        // Don't let a heading sit alone at the bottom of a page.
        keepNext: true,
        keepLines: true,
      };

      if (level === 1) opts.alignment = "center";

      paragraphs.push(new Paragraph(opts));
      continue;
    }

    // Technical Skills: compact "**Label:** a, b, c" lines like a classic resume —
    // left-aligned (no justified stretching), no bullets, no extra spacing, and
    // wrapped lines return to the left margin.
    if (inSkillsSection) {
      const skillText = trimmed.replace(/^\s*(?:[-*]|\d+\.)\s+/, "");
      bulletsInBlock++;
      const asBullets = render.skillsLayout === "bullets";
      paragraphs.push(
        new Paragraph({
          children:
            render.skillsEmphasis === "skills"
              ? skillLineWithBoldSkills(skillText)
              : parseInlineToParagraphChildren(skillText),
          alignment: "left",
          ...(asBullets
            ? {
                numbering: { reference: "bullet", level: 0 },
                spacing: { before: 0, after: ptToTwips(render.bulletSpacingAfterPt) },
              }
            : { spacing: { before: 0, after: 0, line: 240 } }),
          ...(bulletsInBlock < KEEP_FIRST_SKILL_LINES ? { keepNext: true } : {}),
        })
      );
      continue;
    }

    const ulMatch = trimmed.match(/^[\s]*[-*]\s+(.*)$/);

    if (ulMatch) {
      bulletsInBlock++;
      paragraphs.push(
        new Paragraph({
          children: parseInlineToParagraphChildren(ulMatch[1]),
          numbering: { reference: "bullet", level: 0 },
          ...(render.bulletSpacingAfterPt
            ? { spacing: { after: ptToTwips(render.bulletSpacingAfterPt) } }
            : {}),
          // Keep the first few bullets attached to the header block.
          ...(bulletsInBlock < KEEP_FIRST_BULLETS ? { keepNext: true } : {}),
        })
      );
      continue;
    }

    const olMatch = trimmed.match(/^[\s]*\d+\.\s+(.*)$/);

    if (olMatch) {
      bulletsInBlock++;
      paragraphs.push(
        new Paragraph({
          children: parseInlineToParagraphChildren(olMatch[1]),
          numbering: {
            reference: "default-numbering",
            level: 0,
            instance: listInstance,
          },
          // Keep the first few bullets attached to the header block.
          ...(bulletsInBlock < KEEP_FIRST_BULLETS ? { keepNext: true } : {}),
        })
      );
      continue;
    }

    const quoteMatch = trimmed.match(/^>\s?(.*)$/);

    if (quoteMatch) {
      paragraphs.push(
        new Paragraph({
          children: parseInlineToParagraphChildren(quoteMatch[1]),
          indent: { left: 720 },
        })
      );
      continue;
    }

    // A company/role header is an all-bold line. Keep the whole job header block
    // (company, title, dates) together with its first bullet so it is never
    // split across pages and moves to the next page as a unit when it doesn't
    // fit at the bottom.
    const boldHeader = isEntirelyBoldLine(trimmed);
    if (boldHeader) {
      listInstance++; // company/role line => restart numbering
      bulletsInBlock = 0; // start counting this job's bullets afresh
    }
    // Keep the full header block (company, title, dates) together.
    const keepWithNext = boldHeader || leadsIntoBullets(i);

    // Under the name: an all-bold line is the job-title subtitle; others are contact info.
    let extra: RunExtra = {};
    if (inHeaderZone) {
      if (boldHeader && render.subtitleSizePt) {
        extra = { size: ptToHalfPoints(render.subtitleSizePt) };
      } else if (!boldHeader && render.contactColor) {
        extra = { color: render.contactColor };
      }
    }

    // Icon size ~ the text's cap height + a little (pt -> px at 96 dpi).
    const contactChildren =
      inHeaderZone && !boldHeader
        ? contactLineWithIcons(
            trimmed,
            extra,
            render.accentColor ?? render.contactColor ?? "404040",
            Math.round(bodyFontPt * (96 / 72) * 0.95)
          )
        : null;

    paragraphs.push(
      new Paragraph({
        children: contactChildren ?? parseInlineToParagraphChildren(trimmed, extra),
        ...(inHeaderZone
          ? {
              alignment: "center" as const,
              ...(render.contactColor ? { spacing: { after: ptToTwips(4) } } : {}),
            }
          : {}),
        ...(keepWithNext ? { keepNext: true } : {}),
      })
    );
  }

  return paragraphs;
}

export type DocxStyleConfig = {
  page: {
    marginTopIn: number;
    marginRightIn: number;
    marginBottomIn: number;
    marginLeftIn: number;
    marginHeaderIn: number;
    marginFooterIn: number;
    orientation: "portrait" | "landscape";
  };
  body: {
    fontSizePt: number;
    fontFamily: string;
    alignment: "left" | "center" | "right" | "both";
  };
  heading1: {
    fontSizePt: number;
    fontFamily: string;
    bold: boolean;
    spacingBeforePt: number;
    spacingAfterPt: number;
    alignment: "left" | "center" | "right" | "both";
  };
  heading2: {
    fontSizePt: number;
    fontFamily: string;
    bold: boolean;
    spacingBeforePt: number;
    spacingAfterPt: number;
    underline: boolean;
  };
  heading3: {
    fontSizePt: number;
    fontFamily: string;
    bold: boolean;
    spacingBeforePt: number;
    spacingAfterPt: number;
  };
  heading4: {
    fontSizePt: number;
    fontFamily: string;
    bold: boolean;
    spacingBeforePt: number;
    spacingAfterPt: number;
  };
  heading5: {
    fontSizePt: number;
    fontFamily: string;
    bold: boolean;
    spacingBeforePt: number;
    spacingAfterPt: number;
  };
  heading6: {
    fontSizePt: number;
    fontFamily: string;
    bold: boolean;
    spacingBeforePt: number;
    spacingAfterPt: number;
  };
};

const DEFAULT_DOCX_STYLE: DocxStyleConfig = {
  page: {
    marginTopIn: 0.5,
    marginRightIn: 0.5,
    marginBottomIn: 0.5,
    marginLeftIn: 0.5,
    marginHeaderIn: 0.3,
    marginFooterIn: 0.3,
    orientation: "portrait",
  },
  body: {
    fontSizePt: 11,
    fontFamily: "Calibri",
    alignment: "both",
  },
  heading1: {
    fontSizePt: 28,
    fontFamily: "Calibri",
    bold: true,
    spacingBeforePt: 0,
    spacingAfterPt: 10,
    alignment: "center",
  },
  heading2: {
    fontSizePt: 14,
    fontFamily: "Calibri",
    bold: true,
    spacingBeforePt: 12,
    spacingAfterPt: 6,
    underline: true,
  },
  heading3: {
    fontSizePt: 14,
    fontFamily: "Calibri",
    bold: true,
    spacingBeforePt: 10,
    spacingAfterPt: 4,
  },
  heading4: {
    fontSizePt: 12,
    fontFamily: "Calibri",
    bold: true,
    spacingBeforePt: 8,
    spacingAfterPt: 3,
  },
  heading5: {
    fontSizePt: 11,
    fontFamily: "Calibri",
    bold: true,
    spacingBeforePt: 6,
    spacingAfterPt: 2,
  },
  heading6: {
    fontSizePt: 11,
    fontFamily: "Calibri",
    bold: true,
    spacingBeforePt: 5,
    spacingAfterPt: 2,
  },
};

/** A resume style preset: page/font settings, rendering choices, and extra prompt rules. */
type ResumeTemplate = {
  id: string;
  label: string;
  description: string;
  style: DocxStyleConfig;
  render: RenderOptions;
  /** Formatting rules appended to the prompt so the AI writes the Markdown this style expects. */
  promptAddendum: string;
};

/**
 * Formatting rules for the "modern" family of styles (title under the name,
 * "Title | Company - Location" job lines, bold keywords, skills as bullets).
 */
const MODERN_ADDENDUM = `=== OUTPUT STYLE ===
These formatting rules override the earlier formatting rules where they conflict:
- Line 1: "# <Full Name>" in normal capitalization (e.g. # Marcin Pham).
- Line 2: the target job title alone in bold, e.g. **Senior Full Stack Engineer**.
- Line 3: the contact line "<Location> | <Email> | <Phone> | <LinkedIn>".
- Section headings exactly: ## Summary, ## Skills, ## Professional Experience, ## Education, ## Languages.
- Each job starts with one line "### <Job Title> | <Company> - <Location>", then the dates alone on the next line in italics (e.g. *May 2025 – Jan 2026*), then the bullets.
- In the Summary and in experience bullets, bold the key technologies and important phrases with **...** (about 2-5 per bullet).
- Skills: keep the same 13 categories and minimum counts, one bullet per category as "- Category: skill, skill, skill".`;

/** Build a DocxStyleConfig from a font, sizes and margins (keeps presets short). */
function makeStyle(o: {
  font: string;
  body: number;
  name: number;
  section: number;
  job: number;
  margin: number;
  align: "left" | "both";
  sectionBefore?: number;
  sectionAfter?: number;
  rule?: boolean;
}): DocxStyleConfig {
  const h = (size: number, before: number, after: number) => ({
    fontSizePt: size,
    fontFamily: o.font,
    bold: true,
    spacingBeforePt: before,
    spacingAfterPt: after,
  });
  return {
    page: {
      ...DEFAULT_DOCX_STYLE.page,
      marginTopIn: o.margin,
      marginRightIn: o.margin,
      marginBottomIn: o.margin,
      marginLeftIn: o.margin,
    },
    body: { fontSizePt: o.body, fontFamily: o.font, alignment: o.align },
    heading1: { ...h(o.name, 0, 6), alignment: "center" },
    heading2: {
      ...h(o.section, o.sectionBefore ?? 12, o.sectionAfter ?? 5),
      underline: o.rule ?? true,
    },
    heading3: h(o.job, 9, 2),
    heading4: h(o.body + 0.5, 6, 2),
    heading5: h(o.body, 5, 2),
    heading6: h(o.body, 4, 2),
  };
}

const RESUME_TEMPLATES: ResumeTemplate[] = [
  {
    id: "classic",
    label: "Classic",
    description: "Calibri, UPPERCASE headings with a line below, bold skill labels",
    style: DEFAULT_DOCX_STYLE,
    render: CLASSIC_RENDER,
    promptAddendum: "",
  },
  {
    id: "modern",
    label: "Modern",
    description: "Arial, title under the name, gray rules above headings, bold keywords",
    style: {
      page: { ...DEFAULT_DOCX_STYLE.page, marginTopIn: 0.6, marginRightIn: 0.75, marginBottomIn: 0.6, marginLeftIn: 0.75 },
      body: { fontSizePt: 10.5, fontFamily: "Arial", alignment: "left" },
      heading1: { fontSizePt: 24, fontFamily: "Arial", bold: true, spacingBeforePt: 0, spacingAfterPt: 8, alignment: "center" },
      heading2: { fontSizePt: 14, fontFamily: "Arial", bold: true, spacingBeforePt: 14, spacingAfterPt: 6, underline: true },
      heading3: { fontSizePt: 11, fontFamily: "Arial", bold: true, spacingBeforePt: 10, spacingAfterPt: 2 },
      heading4: { fontSizePt: 11, fontFamily: "Arial", bold: true, spacingBeforePt: 6, spacingAfterPt: 2 },
      heading5: { fontSizePt: 10.5, fontFamily: "Arial", bold: true, spacingBeforePt: 6, spacingAfterPt: 2 },
      heading6: { fontSizePt: 10.5, fontFamily: "Arial", bold: true, spacingBeforePt: 4, spacingAfterPt: 2 },
    },
    render: {
      headingCase: "title",
      headingRule: "above",
      ruleColor: "A6A6A6",
      bulletChar: "•",
      bulletIndent: { left: 540, hanging: 270 },
      bulletSpacingAfterPt: 4,
      skillsLayout: "bullets",
      skillsEmphasis: "skills",
      subtitleSizePt: 13,
      contactColor: "595959",
    },
    promptAddendum: MODERN_ADDENDUM,

  },
  {
    id: "compact",
    label: "Compact",
    description: "Calibri 10pt, narrow margins, tight spacing — fits more per page",
    style: {
      page: { ...DEFAULT_DOCX_STYLE.page, marginTopIn: 0.4, marginRightIn: 0.45, marginBottomIn: 0.4, marginLeftIn: 0.45 },
      body: { fontSizePt: 10, fontFamily: "Calibri", alignment: "both" },
      heading1: { fontSizePt: 20, fontFamily: "Calibri", bold: true, spacingBeforePt: 0, spacingAfterPt: 4, alignment: "center" },
      heading2: { fontSizePt: 11.5, fontFamily: "Calibri", bold: true, spacingBeforePt: 8, spacingAfterPt: 3, underline: true },
      heading3: { fontSizePt: 11, fontFamily: "Calibri", bold: true, spacingBeforePt: 6, spacingAfterPt: 1 },
      heading4: { fontSizePt: 10.5, fontFamily: "Calibri", bold: true, spacingBeforePt: 4, spacingAfterPt: 1 },
      heading5: { fontSizePt: 10, fontFamily: "Calibri", bold: true, spacingBeforePt: 3, spacingAfterPt: 1 },
      heading6: { fontSizePt: 10, fontFamily: "Calibri", bold: true, spacingBeforePt: 3, spacingAfterPt: 1 },
    },
    render: { ...CLASSIC_RENDER, bulletChar: "•", bulletIndent: { left: 300, hanging: 160 } },
    promptAddendum: "",
  },
  {
    id: "elegant",
    label: "Elegant",
    description: "Cambria serif, navy name and headings with navy rules",
    style: {
      page: { ...DEFAULT_DOCX_STYLE.page, marginTopIn: 0.6, marginRightIn: 0.65, marginBottomIn: 0.6, marginLeftIn: 0.65 },
      body: { fontSizePt: 10.5, fontFamily: "Cambria", alignment: "both" },
      heading1: { fontSizePt: 24, fontFamily: "Cambria", bold: true, spacingBeforePt: 0, spacingAfterPt: 6, alignment: "center" },
      heading2: { fontSizePt: 12.5, fontFamily: "Cambria", bold: true, spacingBeforePt: 12, spacingAfterPt: 5, underline: true },
      heading3: { fontSizePt: 12, fontFamily: "Cambria", bold: true, spacingBeforePt: 9, spacingAfterPt: 3 },
      heading4: { fontSizePt: 11, fontFamily: "Cambria", bold: true, spacingBeforePt: 6, spacingAfterPt: 2 },
      heading5: { fontSizePt: 10.5, fontFamily: "Cambria", bold: true, spacingBeforePt: 5, spacingAfterPt: 2 },
      heading6: { fontSizePt: 10.5, fontFamily: "Cambria", bold: true, spacingBeforePt: 4, spacingAfterPt: 2 },
    },
    render: {
      ...CLASSIC_RENDER,
      ruleColor: "1F3864",
      accentColor: "1F3864",
      bulletChar: "▪",
      bulletIndent: { left: 400, hanging: 200 },
      bulletSpacingAfterPt: 1,
      contactColor: "404040",
    },
    promptAddendum: "",
  },
  {
    id: "executive",
    label: "Executive",
    description: "Georgia serif, charcoal UPPERCASE headings, gray rules",
    style: makeStyle({ font: "Georgia", body: 10.5, name: 24, section: 12, job: 11.5, margin: 0.7, align: "both", sectionBefore: 14 }),
    render: {
      ...CLASSIC_RENDER,
      ruleColor: "7F7F7F",
      accentColor: "262626",
      bulletChar: "•",
      bulletIndent: { left: 400, hanging: 200 },
      bulletSpacingAfterPt: 2,
      contactColor: "404040",
    },
    promptAddendum: "",
  },
  {
    id: "minimal",
    label: "Minimal",
    description: "Arial, no lines, title-case headings, dash bullets, lots of white space",
    style: makeStyle({ font: "Arial", body: 10.5, name: 22, section: 13, job: 11, margin: 0.8, align: "left", sectionBefore: 16, sectionAfter: 4, rule: false }),
    render: {
      ...CLASSIC_RENDER,
      headingCase: "title",
      bulletChar: "–",
      bulletIndent: { left: 360, hanging: 220 },
      bulletSpacingAfterPt: 3,
      contactColor: "595959",
    },
    promptAddendum: "",
  },
  {
    id: "tech-blue",
    label: "Tech Blue",
    description: "Calibri, blue name/headings with blue rules, title line, bold keywords",
    style: makeStyle({ font: "Calibri", body: 11, name: 26, section: 14, job: 11.5, margin: 0.6, align: "left" }),
    render: {
      headingCase: "title",
      headingRule: "below",
      ruleColor: "2E74B5",
      accentColor: "2E74B5",
      bulletChar: "•",
      bulletIndent: { left: 450, hanging: 230 },
      bulletSpacingAfterPt: 3,
      skillsLayout: "bullets",
      skillsEmphasis: "skills",
      subtitleSizePt: 13,
      contactColor: "595959",
    },
    promptAddendum: MODERN_ADDENDUM,
  },
  {
    id: "traditional",
    label: "Traditional",
    description: "Times New Roman 11pt, UPPERCASE headings, black rules — conservative",
    style: makeStyle({ font: "Times New Roman", body: 11, name: 22, section: 12, job: 11.5, margin: 0.75, align: "both" }),
    render: { ...CLASSIC_RENDER, bulletChar: "•", bulletIndent: { left: 400, hanging: 200 } },
    promptAddendum: "",
  },
  {
    id: "teal",
    label: "Teal Accent",
    description: "Trebuchet MS, teal headings with teal rules above, title line, bold keywords",
    style: makeStyle({ font: "Trebuchet MS", body: 10.5, name: 24, section: 13.5, job: 11, margin: 0.7, align: "left", sectionBefore: 14, sectionAfter: 6 }),
    render: {
      headingCase: "title",
      headingRule: "above",
      ruleColor: "0F7173",
      accentColor: "0F7173",
      bulletChar: "•",
      bulletIndent: { left: 500, hanging: 250 },
      bulletSpacingAfterPt: 4,
      skillsLayout: "bullets",
      skillsEmphasis: "skills",
      subtitleSizePt: 12.5,
      contactColor: "595959",
    },
    promptAddendum: MODERN_ADDENDUM,
  },
  {
    id: "burgundy",
    label: "Burgundy Serif",
    description: "Garamond 11.5pt, burgundy name/headings with burgundy rules",
    style: makeStyle({ font: "Garamond", body: 11.5, name: 26, section: 13, job: 12, margin: 0.7, align: "both" }),
    render: {
      ...CLASSIC_RENDER,
      ruleColor: "7B1E1E",
      accentColor: "7B1E1E",
      bulletChar: "◦",
      bulletIndent: { left: 400, hanging: 200 },
      bulletSpacingAfterPt: 1,
      contactColor: "404040",
    },
    promptAddendum: "",
  },
];

function getTemplate(id: string | null | undefined): ResumeTemplate {
  return RESUME_TEMPLATES.find((t) => t.id === id) ?? RESUME_TEMPLATES[0];
}

const TEMPLATE_STORAGE_KEY = "resume-template";

function ptToHalfPoints(pt: number): number {
  return Math.round(pt * 2);
}

function ptToTwips(pt: number): number {
  return Math.round(pt * 20);
}

function buildStylesFromConfig(cfg: DocxStyleConfig, render: RenderOptions = CLASSIC_RENDER) {
  const accent = render.accentColor ? { color: render.accentColor } : {};
  const rule = {
    style: BorderStyle.SINGLE,
    size: 6,
    color: render.ruleColor,
    space: render.headingRule === "above" ? 8 : 1,
  };
  return {
    default: {
      document: {
        run: {
          size: ptToHalfPoints(cfg.body.fontSizePt),
          font: cfg.body.fontFamily,
        },
        paragraph: {
          alignment: cfg.body.alignment,
        },
      },
      heading1: {
        run: {
          size: ptToHalfPoints(cfg.heading1.fontSizePt),
          bold: cfg.heading1.bold,
          font: cfg.heading1.fontFamily,
          ...accent,
        },
        paragraph: {
          alignment: cfg.heading1.alignment,
          spacing: {
            before: ptToTwips(cfg.heading1.spacingBeforePt),
            after: ptToTwips(cfg.heading1.spacingAfterPt),
          },
        },
      },
      heading2: {
        run: {
          size: ptToHalfPoints(cfg.heading2.fontSizePt),
          bold: cfg.heading2.bold,
          font: cfg.heading2.fontFamily,
          ...accent,
        },
        paragraph: {
          ...(cfg.heading2.underline
            ? {
                border:
                  render.headingRule === "above" ? { top: rule } : { bottom: rule },
              }
            : {}),
          spacing: {
            before: ptToTwips(cfg.heading2.spacingBeforePt),
            after: ptToTwips(cfg.heading2.spacingAfterPt),
          },
        },
      },
      heading3: {
        run: {
          size: ptToHalfPoints(cfg.heading3.fontSizePt),
          bold: cfg.heading3.bold,
          font: cfg.heading3.fontFamily,
        },
        paragraph: {
          spacing: {
            before: ptToTwips(cfg.heading3.spacingBeforePt),
            after: ptToTwips(cfg.heading3.spacingAfterPt),
          },
        },
      },
      heading4: {
        run: {
          size: ptToHalfPoints(cfg.heading4.fontSizePt),
          bold: cfg.heading4.bold,
          font: cfg.heading4.fontFamily,
        },
        paragraph: {
          spacing: {
            before: ptToTwips(cfg.heading4.spacingBeforePt),
            after: ptToTwips(cfg.heading4.spacingAfterPt),
          },
        },
      },
      heading5: {
        run: {
          size: ptToHalfPoints(cfg.heading5.fontSizePt),
          bold: cfg.heading5.bold,
          font: cfg.heading5.fontFamily,
        },
        paragraph: {
          spacing: {
            before: ptToTwips(cfg.heading5.spacingBeforePt),
            after: ptToTwips(cfg.heading5.spacingAfterPt),
          },
        },
      },
      heading6: {
        run: {
          size: ptToHalfPoints(cfg.heading6.fontSizePt),
          bold: cfg.heading6.bold,
          font: cfg.heading6.fontFamily,
        },
        paragraph: {
          spacing: {
            before: ptToTwips(cfg.heading6.spacingBeforePt),
            after: ptToTwips(cfg.heading6.spacingAfterPt),
          },
        },
      },
    },
  };
}

function buildDocFromResponse(
  data: ChatResponse,
  styleConfig: DocxStyleConfig,
  render: RenderOptions = CLASSIC_RENDER
): Document {
  const content = (data.content ?? "").trim();

  const children =
    content.length > 0
      ? markdownToParagraphs(content, render, styleConfig.body.fontSizePt)
      : [
          new Paragraph({
            children: [new TextRun({ text: "(No content)", ...RUN_OPTS })],
          }),
        ];

  const page = styleConfig.page;
  const marginIn = (v: number): `${number}in` => `${v}in` as `${number}in`;
  const isLandscape = page.orientation === "landscape";

  const pageWidth = isLandscape
    ? sectionPageSizeDefaults.HEIGHT
    : sectionPageSizeDefaults.WIDTH;

  const pageHeight = isLandscape
    ? sectionPageSizeDefaults.WIDTH
    : sectionPageSizeDefaults.HEIGHT;

  return new Document({
    styles: buildStylesFromConfig(styleConfig, render),
    numbering: {
      config: [
        {
          reference: "bullet",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: render.bulletChar,
              alignment: "start",
              style: {
                paragraph: {
                  indent: render.bulletIndent,
                },
                run: {
                  size: ptToHalfPoints(10),
                  bold: false,
                },
              },
            },
          ],
        },
        {
          reference: "default-numbering",
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: "start",
              style: {
                paragraph: {
                  indent: { left: 360, hanging: 180 },
                },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: pageWidth,
              height: pageHeight,
              orientation: sectionPageSizeDefaults.ORIENTATION,
            },
            margin: {
              top: marginIn(page.marginTopIn),
              right: marginIn(page.marginRightIn),
              bottom: marginIn(page.marginBottomIn),
              left: marginIn(page.marginLeftIn),
              header: marginIn(page.marginHeaderIn),
              footer: marginIn(page.marginFooterIn),
              gutter: "0in" as const,
            },
          },
        },
        children,
      },
    ],
  });
}

/**
 * Send the generated DOCX to the server, which writes it to
 * RESUME_SAVE_DIR/<folder>/<filename> on the local disk. Returns the saved path.
 */
type SaveResult = {
  path: string;
  docxPath?: string | null;
  pdfPath?: string | null;
  pdfError?: string;
  jdPath?: string | null;
};

async function saveDocxToFolder(
  doc: Document,
  name: string,
  folder: string,
  filename: string,
  jobDescription: string
): Promise<SaveResult> {
  const base64 = await Packer.toBase64String(doc);
  const res = await fetch("/api/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      folder,
      filename,
      dataBase64: base64,
      jobDescription,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Save failed (${res.status})`);
  return {
    path: typeof data?.path === "string" ? data.path : `${folder}/${filename}`,
    docxPath: data?.docxPath,
    pdfPath: data?.pdfPath,
    pdfError: data?.pdfError,
    jdPath: data?.jdPath,
  };
}

/** Build the destination folder name from company + role: "Company_Role". */
function buildFolderName(company: string, role: string, fallback: string): string {
  const parts = [company.trim(), role.trim()].filter(Boolean);
  return parts.length ? parts.join("_") : fallback;
}

const INVALID_FILENAME_RE = /[\\/:*?"<>|\x00-\x1f#\[\]{};@!$&'`+=]/gi;

const MAX_BASE_LENGTH = 60;

const textareaStyle = {
  width: "100%",
  minHeight: "100px",
  padding: "0.75rem 1rem",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  color: "var(--text)",
  marginBottom: "0.5rem",
} as const;

const inputStyle = {
  width: "100%",
  padding: "0.6rem 1rem",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  color: "var(--text)",
} as const;

const BUILTIN_DEFAULT_PROMPT = `# Resume Builder

Instruction:
You are a professional resume builder. Analyze the candidate's base resume (in Markdown) and the provided JD. 
Rewrite the resume to perfectly fit the JD, closing all alignment gaps while keeping it natural, readable, and authentic. 
The goal is to achieve 99–100% JD skill coverage and ATS alignment.

1. Formatting
- Summary, work experience, skills, education, languages as ## headings.
- Do not include a Projects section.
- Company names in work experience as ### **Company Name**
- Markdown only; no comments outside content.
- No bold/italics for skills in bullets; no quotes, symbols, or commas before "and", "where", "which".
- Avoid letter like "-"

2. Name
- Name as # <Candidate Name>.
- Attach the info "<Phone Number> | <mail address> | <LinkedIn Address> | <Location>" under the Name section.

3. Summary
- In summary, Start the writing by using "Senior Backend & AI Engineer with... " at first.
- Combine 35% original resume + 65% JD focusing on requirement or qualification.
- Include all field/industry keywords from JD (e.g., AI, Automation, Full Stack).
- Include all domain-specific context if JD requires (e.g., HVAC, finance, ERP, operations).
- Max 550 characters.
- Include soft skills of JD as much as possible "writing", "collaboration"...
- Include expression like excellent writing and documentation skills."
- Do not include hard skills in summary like "Python", "api"
- Begin summary with alternative title of JD make it simple but not same 100%,
- Avoid AI generated expressions like "Proven track record... ", instead make human writing style.
- Even if the role is not AI/ML engineer, include AI/ML work exp briefly.

4. Work Experience

Devs Data LLC (last company)
- Avoid JD mirroring: never copy sentences directly from the job description. Instead, rephrase concepts and combine them with real engineering context
- Write original resume bullets updating it with new skills of JD and ocassionally make it similiar with JD's responsbilites if that bullet is eligable to update it with JD's responsbility.
- After you write the bullet that is similar to JD's responsbility, you must write bullet of original one but it should align JD's requirement or qualification.
- Remove bullets that are quite different with JD's requirement of JD.
- Avoid JD mirroring: never copy sentences directly from the job description. Instead, rephrase concepts and combine them with real engineering context
- keep expression of orignal resume especially verbs but update it with JD's skills 
- 8-10 bullets. Bullet lengths should vary (some 30-40 words, some 20-30 words, some 8-12 words). The 2-3 line rule does NOT apply to this role.
- Use as many JD hard skills + healthcare + fintech context (or main JD domain) as possible.
- Never keep the same order between resume bullets and JD's responsbilites
- Seperate responsbily of JD and rewrite in several bullets if JD's responsbility includes several exp.
- 2-3 of the bullets should feature alternative skills not explicitly in JD.
- Include leadership/mentoring only if JD requires it.
- Include soft skills (collaboration, problem-solving, strategic thinking, ownership, analytical, decision-making) once or twice.
- Rewrite bullets in original style, do not copy JD phrasing directly.
- Incorporate domain KPIs, ERP exposure, finance/accounting principles, operational metrics naturally.
- Even, if the role is not AI/ML engineer, you have to make at least two bullets meaning AI/ML exp.
- Include "startup" in one bullet naturally once if JD requires.
- Include the location of companies.

7N (second company)
- 6-8 bullets. Every bullet must be 2-3 printed lines long: 30-45 words (about 200-300 characters). No short one-line bullets and nothing longer than 3 lines.
- Entry-level style, 10% JD skills incorporated.
- No advanced skills, leadership, or mentoring.
- Mention industry and domain and skills that were not mentioned above work exp (Gspec Technologies) so that the resume include all skills and experience in all domain and industry,

Merixstudio (first company)
- 4-5 bullets. Every bullet must be 2-3 printed lines long: 30-45 words (about 200-300 characters). No short one-line bullets and nothing longer than 3 lines.
- Entry-level style, 10% JD skills incorporated.
- No advanced skills, leadership, or mentoring.
- Mention industry and domain and skills that were not mentioned above work exp (PCS Research Group LLC) so that the resume include all skills and experience in all domain and industry,

Bullet count by role (count only work-experience roles, not projects). This applies to every resume and overrides any other bullet count:
  - Most recent role: 8-10 bullets.
  - The role before it (second most recent): 6-8 bullets.
  - Every older role: 4-5 bullets each.
  - Most recent role: bullet lengths vary (some long, some medium, some short).
  - Every other role: every bullet must be 2-3 printed lines: 30-45 words (about 200-300 characters). Never shorter than 2 lines or longer than 3 lines.
  - Keep the bullets detailed: concrete technologies, what was built, how, and the business/technical outcome.

5. Skill Section (## Technical Skills)
- First, analyze the JD in detail and extract EVERY hard skill, language, framework, tool, platform, cloud service, database, standard and methodology it mentions (requirements, responsibilities, preferred/nice-to-have, tech stack). Do not miss even one.
- Put every JD skill in the right category below, plus closely related alternative skills and the candidate's original relevant skills.
- Use EXACTLY these 13 categories, with these exact names, in this exact order. Do not rename, merge, drop or add categories.
- Format: one line per category as **Category:** skill, skill, skill — no bullets, no blank-line commentary, no parentheses.
- Each category must have AT LEAST the number of skills shown below (more is good; aim for 2–4 more than the minimum, but keep each line to about one or two printed lines). The examples show the style; replace or extend them with the JD's skills.

**Programming Languages:** at least 6 — e.g. Python, TypeScript, JavaScript, Java, SQL, Bash
**Frameworks:** at least 7 — e.g. Node.js, Spring Boot, Django, FastAPI, Flask, Celery, GraphQL
**Frontend:** at least 5 — e.g. React, Next.js, HTML, CSS, Tailwind
**AI/ML:** at least 7 — e.g. LLMs, RAG, Semantic Search, Vector Databases, LangChain, OpenAI APIs, NLP
**Backend:** at least 5 — e.g. REST APIs, GraphQL, Microservices, Event-Driven Architecture, WebSockets
**Databases:** at least 5 — e.g. PostgreSQL, MySQL, MongoDB, Redis, Redshift
**Cloud/DevOps:** at least 7 — e.g. AWS, Azure, Docker, Kubernetes, Terraform, CI/CD, GitHub Actions
**Data Engineering:** at least 4 — e.g. ETL, Data Modeling, Pandas, NumPy
**Security:** at least 6 — e.g. OAuth2, JWT, SSO, RBAC, SOC 2, GDPR
**Testing:** at least 4 — e.g. Jest, PyTest, Cypress, TDD
**Monitoring:** at least 2 — e.g. CloudWatch, ELK Stack
**Methodologies:** at least 4 — e.g. Agile, Scrum, Kanban, Code Reviews
**Core Strengths:** at least 7 short phrases — e.g. Full Stack Development, Cloud-Native Architecture, AI/LLM Integration, Microservices & Distributed Systems, API Design & System Scaling, DevOps & CI/CD Automation, Technical Leadership & Mentoring

- Never output fewer skills in a category than its minimum above.
- Put the JD's most important skills first in each line, mixed with alternatives (not in the JD's exact order).
- Each skill must appear at least once or twice in work experience but more than 4 times regarding main skills.
- No soft skills in skill section.
- When writing skills of JD, do not write same order with JD, instead, with alternative skills mix them and rewrite. 
e.g, GCP, BigQuery, Dataflow, Pub/Sub,you have to add another alternative skills and mix them.
e.g., JD : skill like PostgreSQL, Snowflake, BigQuery, DynamoDB, resume : PostgreSQL, SQLite, Snowflake, Cassandra, BigQuery, DynamoDB, MariaDB, MongoDB, Cassandra, Oracle DB

6. JD Keyword Integration
- Extract all hard, soft, and domain-related keywords.
- Include domain-specific metrics, ERP, operational KPIs, finance, P&L, budgeting, cost analysis, ROI.
- Include ERP troubleshooting, unstructured data handling, and data governance.
- Include alternative terminology for similar JD requirements for ATS optimization.

7. Strict Rules
- Write all experiences and skils of JD to resume.
- Never keep the same order between resume bullets and JD's responsbilites
- Retain every company's real industry on resume (e.g. Gspec Technologies  is IT consulting company majoring healthcare, ecommerce and fintech)
- Avoid percentages in bullets.
- Keep bullets human-friendly, avoid AI-generated phrasing.
- Include soft skills naturally in bullets (collaboration, problem-solving, strategic thinking, ownership).
- The resume length comes from the bullet rules above. Do not add extra bullets or pad bullets beyond 3 lines to reach a page count. Be detailed: every bullet should name concrete technologies, what was built, how, and the business/technical outcome.
- Incorporate industry-specific terminology once or twice (e.g., healthcare, HVAC, SaaS, finance).
- Do not mention about name of company you're applying for.
- Do not mention number from responsibilites of JD.
- Make Staff or principal or lead level in summary and position name at Cherry if JD requires that level.
- Do not change the name of company, period.
- Focus on experience and skills of JD's qualifiation or requirement. Do not miss even one skill or experience.
- Even indicated as "preferred", you must consider it as requirement.
- Mention more than twice about skills of requirement and resposnbilites and preferred skills of JD.

8. Less AI Generated Percent 
- Do not write the same verb expression of JD responsibilites or "what you will",
- Avoid repeating JD verbs; rephrase responsibly.
- Seperate the skill sets of JD in several sentences to avoid awwareness that we copid JD and pasted it.
e.g, In case JD requires "Familiarity with consent management platforms (e.g., TrustArc or similar) and privacy regulations (e.g., CCPA and GDPR)", then in resume
you should write not only "TrustArc" but also it's alternative skill. do not write "CCPA", "GDPR" in same sentence. instead you can use "CCPA" and it's alternative skill except GDPR in same sentence. and use "GDPR" in another skills.
e.g, In case, GCP(BigQuery, Dataflow, Pub/Sub). in this case, you must mention all words GCP, BigQuery, Dataflow, Pub, Sub in resume in seeveral bullets without parenthesis.

e.g, JD : Working with backend (.NET) and frontend (React) engineers to land AI-affecting changes safely.
resume : you should write backend exp in one bullet and frontend exp with another bullet while writing alternative skills except .NET and React, : 
e.g, backend (Java, .Net, ASP), frontend (Angular, React)
- In work exp, you may miss special responsbilites of JD you could not do in the past. e,g. Working on the Python, .Net, Angular services that mediate between Lena and the rest of the platform.
  in this case, you can seperate it as several bullets.

9. Output Requirements
- Markdown only.
- Summary < 500 characters.
- Resume ready for submission; no comments or instructions outside content.

10. Title in summary
- Write Senior AI Engineer or Senior Backend Engineer or Senior Software Engineer if JD requires.

11. Projects
- Do not write a Projects section, even if the base resume has one.

12. Languages section (spoken languages)
- Copy the Languages section from the base resume EXACTLY: the same languages, the same levels, the same order.
- Never add a language (even if the JD asks for German, French, etc.), never remove one, and never change a level.`;

const DEFAULT_PROMPT = BUILTIN_DEFAULT_PROMPT;

/** Read the candidate name from the resume's first "# Name" line, e.g. "# MARCIN PHAM" -> "Marcin Pham". */
/** Find a "## <heading>" section: returns [start of heading line, end of section). */
function findSection(md: string, heading: RegExp): [number, number] | null {
  const lines = md.split("\n");
  let pos = 0;
  let start = -1;
  for (const line of lines) {
    const isH2 = /^##\s+/.test(line);
    if (start >= 0 && isH2) return [start, pos];
    if (start < 0 && isH2 && heading.test(line.replace(/^##\s+/, "").replace(/[*_]/g, "").trim())) {
      start = pos;
    }
    pos += line.length + 1;
  }
  return start >= 0 ? [start, md.length] : null;
}

/**
 * Make the generated resume's Languages section match the base resume (MD file)
 * exactly. Only that section is touched; everything else stays as generated.
 */
function syncLanguagesSection(generated: string, base: string): string {
  const LANG = /^languages?$/i;
  const b = findSection(base, LANG);
  const g = findSection(generated, LANG);
  if (!b || !g) return generated; // nothing to copy, or no section to replace
  const baseBody = base.slice(b[0], b[1]).split("\n").slice(1).join("\n").trim();
  const headingLine = generated.slice(g[0], g[1]).split("\n")[0];
  const rest = generated.slice(g[1]);
  return (
    generated.slice(0, g[0]) +
    headingLine + "\n\n" + baseBody + "\n" +
    (rest ? "\n" + rest : "")
  );
}

function nameFromResume(md: string): string {
  const m = md.match(/^#\s+(.+)$/m);
  if (!m) return "";
  return m[1]
    .replace(/[*_`]/g, "")
    .trim()
    .toLowerCase()
    .replace(/(^|[\s'-])([^\s'-])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

export default function Home() {
  // const [apiKey, setApiKey] = useState("");
  const [personName, setPersonName] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [resume, setResume] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [templateId, setTemplateId] = useState<string>(RESUME_TEMPLATES[0].id);
  const template = getTemplate(templateId);
  const [docxStyle, setDocxStyle] =
    useState<DocxStyleConfig>(DEFAULT_DOCX_STYLE);

  /** Switch resume style: applies its page/font settings and remembers the choice. */
  function chooseTemplate(id: string) {
    const t = getTemplate(id);
    setTemplateId(t.id);
    setDocxStyle(t.style);
    try {
      localStorage.setItem(TEMPLATE_STORAGE_KEY, t.id);
    } catch {
      /* storage unavailable — choice just isn't remembered */
    }
  }

  // Restore the last chosen style (each profile/port remembers its own).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(TEMPLATE_STORAGE_KEY);
      if (saved) {
        const t = getTemplate(saved);
        setTemplateId(t.id);
        setDocxStyle(t.style);
      }
    } catch {
      /* ignore */
    }
  }, []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [, setLastResponse] = useState<ChatResponse | null>(null);

  // Generated resume kept in memory for the Q&A panel until "New Resume".
  const [storedResume, setStoredResume] = useState<string>("");
  const [qaHistory, setQaHistory] = useState<{ q: string; a: string }[]>([]);
  const [question, setQuestion] = useState("");
  const [qaLoading, setQaLoading] = useState(false);
  const [qaError, setQaError] = useState<string | null>(null);

  // Pre-fill the Resume field from show_resume.txt on the server.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/resume")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && typeof data?.content === "string" && data.content) {
          setResume(data.content);
          const name = nameFromResume(data.content);
          if (name) setPersonName(name);
        }
      })
      .catch(() => {
        /* keep field empty/editable on failure */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function fetchWithRetry(
    url: string,
    options: RequestInit,
    maxRetries = 3
  ): Promise<Response> {
    const retryableStatuses = [408, 429, 502, 503, 504];
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(url, options);

        if (
          res.ok ||
          !retryableStatuses.includes(res.status) ||
          attempt === maxRetries
        ) {
          return res;
        }

        await res.text();
        lastError = new Error(`HTTP ${res.status}`);

        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error("Request failed");

        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        } else {
          throw lastError;
        }
      }
    }

    throw lastError ?? new Error("Request failed");
  }

  async function readStreamedChatResponse(
    res: Response,
    generatedFileName: string,
    styleConfig: DocxStyleConfig,
    folder: string,
    render: RenderOptions
  ): Promise<void> {
    const contentType = res.headers.get("content-type") ?? "";

    if (!contentType.includes("ndjson")) {
      const data = await res.json();
      setError(data.error ?? `Request failed (${res.status})`);
      return;
    }

    const reader = res.body?.getReader();

    if (!reader) {
      setError("No response body");
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";

    let donePayload: {
      reasoning_details?: unknown;
      role?: string;
      finish_reason?: string;
    } | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();

          if (!trimmed) continue;

          let obj: {
            content?: string;
            done?: boolean;
            error?: string;
            reasoning_details?: unknown;
            role?: string;
            finish_reason?: string;
          };

          try {
            obj = JSON.parse(trimmed);
          } catch {
            continue;
          }

          if (obj.error) {
            setError(obj.error);
            return;
          }

          if (obj.content !== undefined) {
            content += obj.content;
          }

          if (obj.done) {
            donePayload = {
              reasoning_details: obj.reasoning_details,
              role: obj.role,
              finish_reason: obj.finish_reason,
            };
          }
        }
      }

      const data: ChatResponse = {
        // Only the Languages section is copied from the base resume (MD file).
        content: resume.trim() ? syncLanguagesSection(content, resume) : content,
        ...donePayload,
      };

      setLastResponse(data);
      // Remember the generated resume for the Q&A panel.
      if (data.content?.trim()) {
        setStoredResume(data.content);
        setQaHistory([]);
        setQaError(null);
      }

      const doc = buildDocFromResponse(data, styleConfig, render);
      const result = await saveDocxToFolder(
        doc,
        personName,
        folder,
        generatedFileName,
        jobDescription
      );
      setSavedPath(result.pdfPath || result.docxPath || result.path);
      if (result.pdfError) {
        setError(
          `Saved as DOCX, but PDF conversion failed: ${result.pdfError}`
        );
      }
      // Clear company/role so the next run starts fresh.
      setCompany("");
      setRole("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stream read failed");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    setError(null);
    setLastResponse(null);
    setSavedPath(null);

    if (!personName.trim()) {
      setError("Your name is required.");
      return;
    }
    if (!company.trim()) {
      setError("Company name is required.");
      return;
    }
    if (!role.trim()) {
      setError("Job role is required.");
      return;
    }

    const parts: string[] = [];

    if (prompt.trim()) parts.push(prompt.trim());
    if (template.promptAddendum) parts.push(template.promptAddendum);
    parts.push(
      `=== TARGET ROLE ===\n\nCompany: ${company.trim()}\nRole: ${role.trim()}`
    );
    if (resume.trim()) parts.push("=== RESUME ===\n\n" + resume.trim());
    if (jobDescription.trim()) {
      parts.push("=== JD (Job Description) ===\n\n" + jobDescription.trim());
    }

    const merged = parts.join("\n\n");

    if (!merged) return;

    setLoading(true);

    const nameBase =
      personName
        .replace(INVALID_FILENAME_RE, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_BASE_LENGTH) || "resume";
    const generatedFileName = `${nameBase}.docx`;
    const folder = buildFolderName(company, role, nameBase);

    try {
      const res = await fetchWithRetry("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: merged,
          generatedFileName,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }

      await readStreamedChatResponse(
        res,
        generatedFileName,
        docxStyle,
        folder,
        template.render
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  /** Stream a single message through /api/chat and return the full text. */
  async function askChat(message: string): Promise<string> {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d?.error ?? `Request failed (${res.status})`);
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        let obj: { content?: string; error?: string };
        try {
          obj = JSON.parse(t);
        } catch {
          continue;
        }
        if (obj.error) throw new Error(obj.error);
        if (obj.content) content += obj.content;
      }
    }
    return content;
  }

  async function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || !storedResume.trim() || qaLoading) return;

    setQaLoading(true);
    setQaError(null);

    const message =
      "You are answering questions about a job candidate using ONLY the resume below. " +
      "Base every answer strictly on the resume content - do not invent, assume, or add anything that is not present in it. " +
      "Tailor each answer to the candidate's background, skills, and experience. " +
      "If the question cannot be answered from the resume, reply exactly: \"That information is not available in the resume.\"\n\n" +
      "=== RESUME ===\n" +
      storedResume +
      "\n\n=== QUESTION ===\n" +
      q;

    try {
      const answer = await askChat(message);
      setQaHistory((h) => [...h, { q, a: answer.trim() || "(no answer)" }]);
      setQuestion("");
    } catch (err) {
      setQaError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setQaLoading(false);
    }
  }

  function handleNewResume() {
    setStoredResume("");
    setQaHistory([]);
    setQuestion("");
    setQaError(null);
    setSavedPath(null);
    setError(null);
    setCompany("");
    setRole("");
    setJobDescription("");
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "2rem",
        maxWidth: storedResume ? "80rem" : "42rem",
        margin: "0 auto",
        display: "flex",
        gap: "2rem",
        alignItems: "flex-start",
        flexWrap: "wrap",
      }}
    >
      <div style={{ flex: "1 1 30rem", minWidth: "min(100%, 22rem)", maxWidth: "42rem" }}>
      <h1
        style={{
          fontSize: "1.75rem",
          fontWeight: 600,
          marginBottom: "0.5rem",
          display: "flex",
          alignItems: "center",
          gap: "0.6rem",
        }}
      >
        {/* Same artwork as app/icon.svg (the browser-tab icon). */}
        <svg
          viewBox="0 0 64 64"
          width="36"
          height="36"
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        >
          <defs>
            <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#818cf8" />
              <stop offset="1" stopColor="#4f46e5" />
            </linearGradient>
          </defs>
          <rect width="64" height="64" rx="14" fill="url(#logo-g)" />
          <path
            d="M19 12h19l9 9v31a2 2 0 0 1-2 2H19a2 2 0 0 1-2-2V14a2 2 0 0 1 2-2z"
            fill="#ffffff"
          />
          <path d="M38 12v7a2 2 0 0 0 2 2h7z" fill="#c7d2fe" />
          <rect x="22" y="19" width="12" height="3.5" rx="1.75" fill="#4f46e5" />
          <rect x="22" y="28" width="20" height="2.5" rx="1.25" fill="#a5b4fc" />
          <rect x="22" y="34" width="20" height="2.5" rx="1.25" fill="#a5b4fc" />
          <rect x="22" y="40" width="14" height="2.5" rx="1.25" fill="#a5b4fc" />
          <path
            d="M13 17v37a4 4 0 0 0 4 4h28"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeDasharray="3.5 3"
          />
        </svg>
        Resume Tailor
      </h1>

      <p
        style={{
          color: "var(--muted)",
          marginBottom: "1.5rem",
        }}
      >
       
      </p>

      <form onSubmit={handleSubmit} noValidate>

        <label style={{ display: "block", marginBottom: "1rem" }}>
          <span
            style={{
              display: "block",
              marginBottom: "0.25rem",
              fontWeight: 500,
            }}
          >
            Your name
          </span>
          <input
            type="text"
            value={personName}
            onChange={(e) => setPersonName(e.target.value)}
            placeholder="Taken from the resume's # heading"
            disabled={loading}
            required
            style={inputStyle}
          />
        </label>

        <div
          style={{
            display: "flex",
            gap: "1rem",
            marginBottom: "1rem",
            flexWrap: "wrap",
          }}
        >
          <label style={{ flex: 1, minWidth: "12rem" }}>
            <span
              style={{
                display: "block",
                marginBottom: "0.25rem",
                fontWeight: 500,
              }}
            >
              Company name
            </span>
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="e.g. Tempus AI"
              disabled={loading}
              required
              style={inputStyle}
            />
          </label>

          <label style={{ flex: 1, minWidth: "12rem" }}>
            <span
              style={{
                display: "block",
                marginBottom: "0.25rem",
                fontWeight: 500,
              }}
            >
              Job role
            </span>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Lead Engineer"
              disabled={loading}
              required
              style={inputStyle}
            />
          </label>
        </div>

        <label
          style={{
            display: "block",
            marginBottom: "0.25rem",
            fontWeight: 500,
          }}
        >
          Prompt
        </label>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. Tailor this resume to the job..."
          disabled={loading}
          style={textareaStyle}
        />

        <label
          style={{
            display: "block",
            marginBottom: "0.25rem",
            fontWeight: 500,
          }}
        >
          Resume
        </label>

        <textarea
          value={resume}
          onChange={(e) => setResume(e.target.value)}
          placeholder="Paste resume text here..."
          disabled={loading}
          style={{ ...textareaStyle, minHeight: "140px" }}
        />

        <label
          style={{
            display: "block",
            marginBottom: "0.25rem",
            fontWeight: 500,
          }}
        >
          Job description
        </label>

        <textarea
          value={jobDescription}
          onChange={(e) => setJobDescription(e.target.value)}
          placeholder="Paste job description here..."
          disabled={loading}
          style={{ ...textareaStyle, minHeight: "140px" }}
        />

        <label
          style={{
            display: "block",
            marginTop: "1rem",
            marginBottom: "0.25rem",
            fontWeight: 500,
          }}
        >
          Resume style
        </label>
        <select
          value={templateId}
          onChange={(e) => chooseTemplate(e.target.value)}
          disabled={loading}
          style={inputStyle}
        >
          {RESUME_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label} — {t.description}
            </option>
          ))}
        </select>

        <details style={{ marginTop: "1rem", marginBottom: "0.5rem" }}>
          <summary style={{ cursor: "pointer", fontWeight: 500 }}>
            DOCX styling (fine-tune the selected style)
          </summary>

          <div
            style={{
              marginTop: "0.75rem",
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
              padding: "0.5rem 0",
            }}
          >
            <fieldset
              style={{
                border: "1px solid var(--border)",
                borderRadius: "6px",
                padding: "0.75rem",
              }}
            >
              <legend style={{ fontWeight: 500 }}>Page layout</legend>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, 1fr)",
                  gap: "0.5rem 1rem",
                }}
              >
                <label>
                  Top (in){" "}
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={docxStyle.page.marginTopIn}
                    onChange={(e) =>
                      setDocxStyle((s) => ({
                        ...s,
                        page: {
                          ...s.page,
                          marginTopIn: Number(e.target.value) || 0,
                        },
                      }))
                    }
                    style={{ width: "4rem", marginLeft: "0.25rem" }}
                  />
                </label>

                <label>
                  Right (in){" "}
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={docxStyle.page.marginRightIn}
                    onChange={(e) =>
                      setDocxStyle((s) => ({
                        ...s,
                        page: {
                          ...s.page,
                          marginRightIn: Number(e.target.value) || 0,
                        },
                      }))
                    }
                    style={{ width: "4rem", marginLeft: "0.25rem" }}
                  />
                </label>

                <label>
                  Bottom (in){" "}
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={docxStyle.page.marginBottomIn}
                    onChange={(e) =>
                      setDocxStyle((s) => ({
                        ...s,
                        page: {
                          ...s.page,
                          marginBottomIn: Number(e.target.value) || 0,
                        },
                      }))
                    }
                    style={{ width: "4rem", marginLeft: "0.25rem" }}
                  />
                </label>

                <label>
                  Left (in){" "}
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={docxStyle.page.marginLeftIn}
                    onChange={(e) =>
                      setDocxStyle((s) => ({
                        ...s,
                        page: {
                          ...s.page,
                          marginLeftIn: Number(e.target.value) || 0,
                        },
                      }))
                    }
                    style={{ width: "4rem", marginLeft: "0.25rem" }}
                  />
                </label>

                <label>
                  Header (in){" "}
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={docxStyle.page.marginHeaderIn}
                    onChange={(e) =>
                      setDocxStyle((s) => ({
                        ...s,
                        page: {
                          ...s.page,
                          marginHeaderIn: Number(e.target.value) || 0,
                        },
                      }))
                    }
                    style={{ width: "4rem", marginLeft: "0.25rem" }}
                  />
                </label>

                <label>
                  Footer (in){" "}
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={docxStyle.page.marginFooterIn}
                    onChange={(e) =>
                      setDocxStyle((s) => ({
                        ...s,
                        page: {
                          ...s.page,
                          marginFooterIn: Number(e.target.value) || 0,
                        },
                      }))
                    }
                    style={{ width: "4rem", marginLeft: "0.25rem" }}
                  />
                </label>

                <label>
                  Orientation{" "}
                  <select
                    value={docxStyle.page.orientation}
                    onChange={(e) =>
                      setDocxStyle((s) => ({
                        ...s,
                        page: {
                          ...s.page,
                          orientation: e.target.value as
                            | "portrait"
                            | "landscape",
                        },
                      }))
                    }
                    style={{ marginLeft: "0.25rem" }}
                  >
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </label>
              </div>
            </fieldset>

            <fieldset
              style={{
                border: "1px solid var(--border)",
                borderRadius: "6px",
                padding: "0.75rem",
              }}
            >
              <legend style={{ fontWeight: 500 }}>Body text</legend>

              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                <label>
                  Font size (pt){" "}
                  <input
                    type="number"
                    step="any"
                    min={6}
                    max={72}
                    value={docxStyle.body.fontSizePt}
                    onChange={(e) =>
                      setDocxStyle((s) => ({
                        ...s,
                        body: {
                          ...s.body,
                          fontSizePt: Number(e.target.value) || 11,
                        },
                      }))
                    }
                    style={{ width: "3rem", marginLeft: "0.25rem" }}
                  />
                </label>

                <label>
                  Font{" "}
                  <input
                    type="text"
                    value={docxStyle.body.fontFamily}
                    onChange={(e) =>
                      setDocxStyle((s) => ({
                        ...s,
                        body: {
                          ...s.body,
                          fontFamily: e.target.value || "Calibri",
                        },
                      }))
                    }
                    style={{ width: "8rem", marginLeft: "0.25rem" }}
                  />
                </label>

                <label>
                  Alignment{" "}
                  <select
                    value={docxStyle.body.alignment}
                    onChange={(e) =>
                      setDocxStyle((s) => ({
                        ...s,
                        body: {
                          ...s.body,
                          alignment: e.target.value as DocxStyleConfig["body"]["alignment"],
                        },
                      }))
                    }
                    style={{ marginLeft: "0.25rem" }}
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                    <option value="both">Justified</option>
                  </select>
                </label>
              </div>
            </fieldset>

            {(
              [
                [1, "heading1" as const],
                [2, "heading2" as const],
                [3, "heading3" as const],
                [4, "heading4" as const],
                [5, "heading5" as const],
                [6, "heading6" as const],
              ] as const
            ).map(([n, key]) => {
              const h = docxStyle[key];

              return (
                <fieldset
                  key={n}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    padding: "0.75rem",
                  }}
                >
                  <legend style={{ fontWeight: 500 }}>Heading {n}</legend>

                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "0.5rem 1rem",
                      alignItems: "center",
                    }}
                  >
                    <label>
                      Size (pt){" "}
                      <input
                        type="number"
                        step="any"
                        min={6}
                        max={72}
                        value={h.fontSizePt}
                        onChange={(e) =>
                          setDocxStyle((s) => ({
                            ...s,
                            [key]: {
                              ...s[key],
                              fontSizePt: Number(e.target.value) || 11,
                            },
                          }))
                        }
                        style={{ width: "3rem", marginLeft: "0.25rem" }}
                      />
                    </label>

                    <label>
                      Font{" "}
                      <input
                        type="text"
                        value={h.fontFamily}
                        onChange={(e) =>
                          setDocxStyle((s) => ({
                            ...s,
                            [key]: {
                              ...s[key],
                              fontFamily: e.target.value || "Calibri",
                            },
                          }))
                        }
                        style={{ width: "7rem", marginLeft: "0.25rem" }}
                      />
                    </label>

                    <label>
                      <input
                        type="checkbox"
                        checked={h.bold}
                        onChange={(e) =>
                          setDocxStyle((s) => ({
                            ...s,
                            [key]: {
                              ...s[key],
                              bold: e.target.checked,
                            },
                          }))
                        }
                      />{" "}
                      Bold
                    </label>

                    <label>
                      Before (pt){" "}
                      <input
                        type="number"
                        step="any"
                        min={0}
                        value={h.spacingBeforePt}
                        onChange={(e) =>
                          setDocxStyle((s) => ({
                            ...s,
                            [key]: {
                              ...s[key],
                              spacingBeforePt: Number(e.target.value) || 0,
                            },
                          }))
                        }
                        style={{ width: "3rem", marginLeft: "0.25rem" }}
                      />
                    </label>

                    <label>
                      After (pt){" "}
                      <input
                        type="number"
                        step="any"
                        min={0}
                        value={h.spacingAfterPt}
                        onChange={(e) =>
                          setDocxStyle((s) => ({
                            ...s,
                            [key]: {
                              ...s[key],
                              spacingAfterPt: Number(e.target.value) || 0,
                            },
                          }))
                        }
                        style={{ width: "3rem", marginLeft: "0.25rem" }}
                      />
                    </label>

                    {n === 1 && "alignment" in h && (
                      <label>
                        Alignment{" "}
                        <select
                          value={docxStyle.heading1.alignment}
                          onChange={(e) =>
                            setDocxStyle((s) => ({
                              ...s,
                              heading1: {
                                ...s.heading1,
                                alignment: e.target.value as DocxStyleConfig["heading1"]["alignment"],
                              },
                            }))
                          }
                          style={{ marginLeft: "0.25rem" }}
                        >
                          <option value="left">Left</option>
                          <option value="center">Center</option>
                          <option value="right">Right</option>
                          <option value="both">Justified</option>
                        </select>
                      </label>
                    )}

                    {n === 2 && "underline" in h && (
                      <label>
                        <input
                          type="checkbox"
                          checked={docxStyle.heading2.underline}
                          onChange={(e) =>
                            setDocxStyle((s) => ({
                              ...s,
                              heading2: {
                                ...s.heading2,
                                underline: e.target.checked,
                              },
                            }))
                          }
                        />{" "}
                        Underline
                      </label>
                    )}
                  </div>
                </fieldset>
              );
            })}

            <button
              type="button"
              onClick={() => setDocxStyle(template.style)}
              style={{
                alignSelf: "start",
                padding: "0.35rem 0.75rem",
                fontSize: "0.9rem",
              }}
            >
              Reset to default
            </button>
          </div>
        </details>

        <button
          type="submit"
          disabled={
            loading || !personName.trim() || !company.trim() || !role.trim()
          }
          style={{
            marginTop: "0.5rem",
            padding: "0.6rem 1.25rem",
            background:
              loading || !personName.trim() || !company.trim() || !role.trim()
                ? "var(--border)"
                : "var(--accent)",
            color: "white",
            border: "none",
            borderRadius: "8px",
            fontWeight: 500,
          }}
        >
          {loading ? "Calling LLM…" : "Generate & download DOCX"}
        </button>
      </form>

      {error && (
        <p
          role="alert"
          style={{
            marginTop: "1rem",
            color: "#f87171",
            fontSize: "0.9rem",
          }}
        >
          {error}
        </p>
      )}

      {savedPath && (
        <p
          style={{
            marginTop: "1rem",
            color: "#34d399",
            fontSize: "0.9rem",
            wordBreak: "break-all",
          }}
        >
          Saved to: {savedPath}
        </p>
      )}
      </div>

      {storedResume && (
        <aside
          style={{
            flex: "1 1 26rem",
            minWidth: "min(100%, 22rem)",
            position: "sticky",
            top: "2rem",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "12px",
            padding: "1.25rem 1.5rem",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "0.5rem",
              gap: "1rem",
            }}
          >
            <h2 style={{ fontSize: "1.25rem", fontWeight: 600 }}>
              Ask about this resume
            </h2>
            <button
              type="button"
              onClick={handleNewResume}
              style={{
                padding: "0.4rem 0.9rem",
                background: "var(--surface)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                fontSize: "0.85rem",
              }}
            >
              New Resume
            </button>
          </div>

          <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "1rem" }}>
            Answers are based only on the generated resume. Click{" "}
            <strong>New Resume</strong> to clear it and start a new session.
          </p>

          {qaHistory.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "1rem" }}>
              {qaHistory.map((item, idx) => (
                <div key={idx}>
                  <p style={{ fontWeight: 600, marginBottom: "0.25rem" }}>Q: {item.q}</p>
                  <p style={{ color: "var(--text)", whiteSpace: "pre-wrap" }}>{item.a}</p>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleAsk} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. How many years of Python experience does the candidate have?"
              disabled={qaLoading}
              style={{ ...inputStyle, flex: 1, minWidth: "16rem" }}
            />
            <button
              type="submit"
              disabled={qaLoading || !question.trim()}
              style={{
                padding: "0.6rem 1.25rem",
                background: qaLoading || !question.trim() ? "var(--border)" : "var(--accent)",
                color: "white",
                border: "none",
                borderRadius: "8px",
                fontWeight: 500,
              }}
            >
              {qaLoading ? "Thinking…" : "Ask"}
            </button>
          </form>

          {qaError && (
            <p role="alert" style={{ marginTop: "0.75rem", color: "#f87171", fontSize: "0.9rem" }}>
              {qaError}
            </p>
          )}
        </aside>
      )}

    </main>
  );
}