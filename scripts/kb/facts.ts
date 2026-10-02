import { loadSocio } from "./structured";

/**
 * "Fact fingerprints": the concrete, checkable details in a passage (times, dates, prices, phone numbers, URLs,
 * levels, room names, quantities). The consolidation step must keep every fingerprint from its inputs, which is
 * how we know merging passages never silently drops a time, room or number.
 */
const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";
let roomNames: string[] | undefined;
function knownRooms(): string[] {
  if (roomNames) return roomNames;
  const names = new Set<string>(["fairmont austin"]);
  for (const room of loadSocio().rooms) {
    const base = room.name.split(",")[0].trim().toLowerCase();
    if (base && !/sponsor:|^meet the experts$/.test(base) && base.length > 3) names.add(base);
  }
  return (roomNames = [...names].sort((a, b) => b.length - a.length));
}

function toMinutes(hour: string, minute: string | undefined, meridiem: string): string {
  let h = Number(hour) % 12;
  if (/^p/i.test(meridiem)) h += 12;
  return `${String(h).padStart(2, "0")}:${minute || "00"}`;
}

export function extractFacts(text: string): Set<string> {
  const facts = new Set<string>();
  const t = text.replace(/\u2013|\u2014/g, "-");
  for (const m of t.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s?([ap])\.?m\b\.?/gi)) facts.add(`time:${toMinutes(m[1], m[2], m[3])}`);
  for (const m of t.matchAll(new RegExp(`\\b(${MONTHS})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "gi"))) facts.add(`date:${m[1].toLowerCase().slice(0, 3)} ${Number(m[2])}`);
  for (const m of t.matchAll(/\$\s?\d[\d,]*(?:\.\d+)?/g)) facts.add(`money:${m[0].replace(/[\s,]/g, "")}`);
  for (const m of t.matchAll(/(?:\+?\d[\d\s().-]{8,}\d)/g)) { const digits = m[0].replace(/\D/g, ""); if (digits.length >= 10 && digits.length <= 13) facts.add(`phone:${digits.slice(-10)}`); }
  for (const m of t.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)) facts.add(`email:${m[0].toLowerCase().replace(/[.,;)]+$/, "")}`);
  for (const m of t.matchAll(/https?:\/\/[^\s)\]>"']+/g)) facts.add(`url:${m[0].toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[.,;)\]]+$/, "").replace(/\/$/, "")}`);
  for (const m of t.matchAll(/\bLevel\s*(\d+)\b/gi)) facts.add(`level:${m[1]}`);
  for (const m of t.matchAll(/\b(\d+(?:\.\d+)?)\s?(minutes?|hours?|miles?|%|percent|credits?|nights?|days?)\b/gi)) facts.add(`qty:${m[1]} ${m[2].toLowerCase().replace(/s$/, "")}`);
  const lower = t.toLowerCase();
  for (const room of knownRooms()) if (lower.includes(room)) facts.add(`room:${room}`);
  return facts;
}

export function missingFacts(source: string[], output: string): string[] {
  const have = extractFacts(output);
  const missing = new Set<string>();
  for (const text of source) for (const fact of extractFacts(text)) if (!have.has(fact)) missing.add(fact);
  return [...missing];
}
