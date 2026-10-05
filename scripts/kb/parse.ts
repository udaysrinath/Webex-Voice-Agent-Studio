import * as fs from "node:fs";
import * as path from "node:path";

export const DATA_DIR = path.resolve(process.cwd(), "server/data/webexone");

export interface Block { kind: "heading" | "para" | "list" | "table"; level?: number; text: string }

/** Strips frontmatter, images and markdown decoration so crawled pages and converted Word files read alike. */
export function readDocument(file: string): { title: string; blocks: Block[] } {
  let raw = fs.readFileSync(path.join(DATA_DIR, file), "utf8");
  let title = "";
  const front = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (front) { title = front[1].match(/title:\s*"?([^"\n]+)"?/)?.[1] || ""; raw = raw.slice(front[0].length); }
  // Converted Word files have no frontmatter; the file name keeps path[0] a stable document label.
  title ||= path.basename(file).replace(/\.md$/, "");
  const cleaned = raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/^\s*Images?:.*$/gim, "")
    .replace(/\[([^\]]+)\]\((https?:[^)]+|mailto:[^)]+)\)/g, (_m, label, url) => label.trim() === url.replace(/^mailto:/, "") ? label : `${label} (${String(url).replace(/^mailto:/, "")})`)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\\([*#_\-.!()])/g, "$1")
    .replace(/[*_`]{1,3}([^*_`\n]+)[*_`]{1,3}/g, "$1")
    .replace(/\u00a0/g, " ")
    // CMS scaffolding in the page copy decks: "[HERO]" lines and "Header:"/"Subhead:" prefixes.
    .replace(/^\[[A-Z0-9 &/-]{3,}\]\s*$/gm, "")
    .replace(/^(Header|Subhead|Eyebrow|CTA|Button|Label):\s*/gim, "");
  const blocks: Block[] = [];
  for (const chunk of cleaned.split(/\n{2,}/)) {
    const text = chunk.trim();
    if (!text) continue;
    const heading = text.match(/^(#{1,6})\s+(.+)$/);
    if (heading && !text.includes("\n")) blocks.push({ kind: "heading", level: heading[1].length, text: heading[2].trim() });
    else if (/^\|.*\|$/m.test(text.split("\n")[0])) blocks.push({ kind: "table", text });
    else if (text.split("\n").every((line) => /^\s*([-*•]|\d+\.)\s+/.test(line) || /^\s{2,}\S/.test(line))) blocks.push({ kind: "list", text: text.replace(/^\s*(?:\d+\.|\*)\s+/gm, "- ") });
    else blocks.push({ kind: "para", text: text.replace(/\n+/g, " ").replace(/\s{2,}/g, " ") });
  }
  return { title, blocks };
}

export const norm = (value: string) => value.toLowerCase().replace(/&amp;/g, "&").replace(/[^a-z0-9]+/g, " ").trim();

export interface QaUnit { section: string; question: string; answer: string }

const QUESTION_WORDS = /^(what|how|where|when|why|can|could|do|does|is|are|will|who|which|should|am|may)\b/i;
// Some Word exports lost the trailing "?", so an interrogative-led short line without sentence punctuation also counts.
const isQuestion = (block: Block) => block.kind === "para" && block.text.length < 200 && !/[.!]\s\S/.test(block.text.replace(/[?.!]$/, ""))
  && (block.text.endsWith("?") || (QUESTION_WORDS.test(block.text) && !/[.!:]$/.test(block.text) && block.text.length < 120));

/** FAQ pages are plain paragraphs: a short line ending in "?" starts an entry; short label lines name the category. */
export function splitFaq(file: string): QaUnit[] {
  const { blocks } = readDocument(file);
  const units: QaUnit[] = [];
  let section = "General";
  let current: QaUnit | undefined;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (isQuestion(block)) {
      current = { section, question: block.text, answer: "" };
      units.push(current);
      continue;
    }
    if (block.kind === "heading" || (block.kind === "para" && block.text.length < 40 && !/[.:]$/.test(block.text) && blocks[i + 1] && isQuestion(blocks[i + 1]))) {
      section = block.text;
      current = undefined;
      continue;
    }
    if (current) current.answer += (current.answer ? "\n\n" : "") + block.text;
  }
  return units.filter((unit) => unit.answer.trim().length > 0);
}

export interface Section { path: string[]; text: string }

/** Heading-delimited passages (long ones split at paragraph boundaries), each keeping its heading path. */
export function splitSections(file: string, maxChars = 1400): Section[] {
  const { title, blocks } = readDocument(file);
  const out: Section[] = [];
  const stack: string[] = [];
  let buffer: string[] = [];
  const flush = () => {
    const body = buffer.join("\n\n").trim();
    buffer = [];
    if (!body) return;
    const paragraphs = body.split("\n\n");
    let part = "";
    for (const paragraph of paragraphs) {
      if (part && part.length + paragraph.length > maxChars) { out.push({ path: [...stack], text: part.trim() }); part = ""; }
      part += (part ? "\n\n" : "") + paragraph;
    }
    if (part.trim()) out.push({ path: [...stack], text: part.trim() });
  };
  for (const block of blocks) {
    if (block.kind === "heading") {
      flush();
      stack.length = Math.max(0, (block.level || 1) - 1);
      while (stack.length < (block.level || 1) - 1) stack.push("");
      stack[(block.level || 1) - 1] = block.text;
    } else buffer.push(block.text);
  }
  flush();
  return out.map((section) => ({ ...section, path: [title, ...section.path.filter(Boolean)].filter(Boolean) }));
}

const DAY_LINE = /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),?\s+(October|Oct\.?)\s+\d+\w*$/i;
// A title is a short, digit-free line without sentence punctuation. Digits mean a time, address or phone number, which is content.
const isTitleLike = (block: Block) => block.kind === "para" && block.text.length < 80 && block.text.split(/\s+/).length <= 9 && !/\d/.test(block.text) && !/[.!?:]$/.test(block.text) && !DAY_LINE.test(block.text);

/**
 * Word exports without heading styles: a run of short lines starts a unit and the long paragraphs and lists
 * after it belong to it. Day lines ("Tuesday, October 6") become context carried into every unit under them.
 */
export function splitPlain(file: string, maxChars = 1600): Section[] {
  const { title, blocks } = readDocument(file);
  const out: Section[] = [];
  let day = "";
  let unit: { head: string[]; body: string[] } | undefined;
  const flush = () => {
    if (!unit) return;
    const body = unit.body.join("\n\n").trim();
    if (unit.head.length || body) {
      const heading = unit.head[0] || "";
      const text = [...unit.head.slice(1), body].filter(Boolean).join("\n\n");
      if (text.trim() || heading) out.push({ path: [title, day, heading].filter(Boolean), text: text.trim() || heading });
    }
    unit = undefined;
  };
  for (const block of blocks) {
    if (block.kind === "heading") { flush(); unit = { head: [block.text], body: [] }; continue; }
    if (block.kind === "para" && DAY_LINE.test(block.text)) { flush(); day = block.text; continue; }
    const short = isTitleLike(block);
    if (short && (!unit || unit.body.length > 0)) { flush(); unit = { head: [block.text], body: [] }; continue; }
    if (short && unit && unit.body.length === 0) { unit.head.push(block.text); continue; }
    unit ||= { head: [], body: [] };
    unit.body.push(block.text);
    if (unit.body.join("\n\n").length > maxChars && block.kind !== "list") { flush(); unit = { head: [], body: [] }; }
  }
  flush();
  // a lone opening line with no body is just a document title
  return out.filter((section) => section.text.length > 25);
}

/** "Q: ... / A: ..." entries (the Austin FAQ), grouped under their heading. */
export function splitQaColon(file: string): QaUnit[] {
  const { blocks } = readDocument(file);
  const units: QaUnit[] = [];
  let section = "General";
  let current: QaUnit | undefined;
  for (const block of blocks) {
    if (block.kind === "heading") { section = block.text; current = undefined; continue; }
    const q = block.text.match(/^Q:\s*(.+)$/);
    const a = block.text.match(/^A:\s*([\s\S]+)$/);
    if (q) { current = { section, question: q[1].trim(), answer: "" }; units.push(current); }
    else if (a && current) current.answer = a[1].trim();
    else if (current && current.answer) current.answer += "\n\n" + block.text;
  }
  return units.filter((unit) => unit.answer);
}

/** CMS markers in the page copy decks ("[HERO]", "Header:", "CTA:") carry no meaning for an attendee. */
export function stripCmsMarkup(text: string): string {
  return text
    .replace(/^\[[A-Z0-9 &/-]{3,}\]\s*$/gm, "")
    .replace(/^(Header|Subhead|Eyebrow|Body|CTA|Button|Label|Title|Description):\s*/gim, "")
    .replace(/^<[^>]*>\s*(https?:\S+)?\s*$/gm, "")
    .replace(/^URL:\s*.*$/gim, "")
    .replace(/\n{3,}/g, "\n\n").trim();
}
