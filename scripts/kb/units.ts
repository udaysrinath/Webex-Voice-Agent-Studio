import { splitFaq, splitPlain, splitQaColon, splitSections, stripCmsMarkup } from "./parse";
import { buildStructuredCards } from "./structured";
import type { CardKind } from "../../server/webexone-kb-types";

export interface Unit {
  id: string;
  source: string;
  /** Higher wins when sources disagree on policy or description. Schedule facts defer to Socio. */
  precedence: number;
  kind: CardKind;
  key: string;
  text: string;
  /** Curated, already agent-ready sources are kept verbatim unless they overlap another source. */
  verbatim: boolean;
}

type Mode = "faq" | "qa-colon" | "sections" | "plain";
interface SourceConfig { file: string; precedence: number; mode: Mode; kind: CardKind; verbatim?: boolean }

export const SOURCES: SourceConfig[] = [
  { file: "onedrive/event-info-activations.md", precedence: 100, mode: "plain", kind: "info" },
  { file: "onedrive/things-to-do-each-day.md", precedence: 100, mode: "plain", kind: "info" },
  { file: "onedrive/austin-faq.md", precedence: 95, mode: "qa-colon", kind: "faq", verbatim: true },
  { file: "onedrive/faqs.md", precedence: 90, mode: "faq", kind: "faq" },
  { file: "onedrive/venue-travel.md", precedence: 90, mode: "sections", kind: "info" },
  { file: "onedrive/training-page.md", precedence: 90, mode: "plain", kind: "info" },
  { file: "onedrive/awards.md", precedence: 90, mode: "sections", kind: "award", verbatim: true },
  { file: "onedrive/sponsors.md", precedence: 90, mode: "sections", kind: "sponsor", verbatim: true },
  { file: "onedrive/devices-portfolio.md", precedence: 90, mode: "sections", kind: "product", verbatim: true },
  { file: "onedrive/launch-items.md", precedence: 90, mode: "sections", kind: "product", verbatim: true },
  { file: "onedrive/launch-items-930.md", precedence: 70, mode: "sections", kind: "product", verbatim: true },
  { file: "onedrive/product-kb.md", precedence: 85, mode: "sections", kind: "product", verbatim: true },
  // The crawled site predates the Oct 1 documents and still carries stale text, so it ranks last.
  { file: "www.webexone.com_faqs.html.md", precedence: 50, mode: "faq", kind: "faq" },
  { file: "www.webexone.com_.md", precedence: 50, mode: "sections", kind: "info" },
  { file: "www.webexone.com_training.html.md", precedence: 50, mode: "sections", kind: "info" },
  { file: "www.webexone.com_venue.html.md", precedence: 50, mode: "sections", kind: "info" },
  { file: "www.webexone.com_awards.html.md", precedence: 50, mode: "sections", kind: "award" },
  { file: "www.webexone.com_sponsorships.html.md", precedence: 50, mode: "sections", kind: "info" },
  { file: "www.webexone.com_tickets.html.md", precedence: 50, mode: "sections", kind: "info" },
  { file: "www.webexone.com_entertainment.html.md", precedence: 50, mode: "sections", kind: "info" },
];

/** Instruction sections inside the agent-oriented documents: kept out of the facts, collected as guidance. */
const GUIDANCE_HEADING = /how the concierge should use|voice of the experience|hard guardrails|recommended answer pattern|agent response guidelines|quick routing|purpose|^version|how to use this/i;

const shortName = (file: string) => file.replace(/^onedrive\//, "").replace(/^www\.webexone\.com_?/, "site-").replace(/\.md$/, "").replace(/\.html$/, "");

export function loadUnits(): { units: Unit[]; guidance: Array<{ source: string; heading: string; text: string }>; report: string[] } {
  const units: Unit[] = [];
  const guidance: Array<{ source: string; heading: string; text: string }> = [];
  const report: string[] = [];
  for (const config of SOURCES) {
    const name = shortName(config.file);
    let count = 0;
    const push = (key: string, text: string) => {
      const cleaned = stripCmsMarkup(text);
      if (cleaned.length < 20) return;
      units.push({ id: `${name}#${count++}`, source: config.file, precedence: config.precedence, kind: config.kind, key, text: cleaned, verbatim: !!config.verbatim });
    };
    if (config.mode === "faq" || config.mode === "qa-colon") {
      for (const qa of config.mode === "faq" ? splitFaq(config.file) : splitQaColon(config.file)) push(qa.question, `Q: ${qa.question}\nA: ${qa.answer}`);
    } else {
      for (const section of config.mode === "plain" ? splitPlain(config.file) : splitSections(config.file)) {
        const heading = section.path[section.path.length - 1] || "";
        if (GUIDANCE_HEADING.test(heading) || GUIDANCE_HEADING.test(section.path[1] || "")) { guidance.push({ source: config.file, heading, text: section.text }); continue; }
        push(section.path.slice(1).join(" > ") || section.path[0] || name, `${section.path.slice(1).join(" > ")}\n${section.text}`.trim());
      }
    }
    report.push(`${config.file}: ${count} units (prec ${config.precedence}${config.verbatim ? ", verbatim" : ""})`);
  }
  const { activityUnits } = buildStructuredCards();
  activityUnits.forEach((activity, index) => units.push({ id: `socio-activity#${index}`, source: "socio", precedence: 95, kind: "activity", key: activity.key, text: activity.text, verbatim: false }));
  report.push(`socio activities: ${activityUnits.length} units (prec 95)`);
  return { units, guidance, report };
}
