import * as fs from "node:fs";
import * as path from "node:path";
import type { KbCard } from "../../server/webexone-kb-types";
import { DATA_DIR, norm, readDocument } from "./parse";

interface SocioRaw {
  timezone: string;
  componentIds: { speakers: number; topics: number };
  sessions: Array<{ id: number; name: string; overview: string | null; startTime: number; endTime: number; region: { name: string } | null; tracks: Array<{ name: string }> | null; component: { name: string } | null; items: Array<{ id: number; name: string; componentId: number }> | null }>;
  speakers: Array<{ id: number; name: string; info: string | null; overview: string | null }>;
  rooms: Array<{ name: string; maxCapacity: number | null }>;
}

export const loadSocio = (): SocioRaw => JSON.parse(fs.readFileSync(path.join(DATA_DIR, "raw/socio.json"), "utf8"));

const htmlToText = (html: string | null | undefined) => (html || "")
  .replace(/<(?:br|\/p|\/div|\/li|\/h\d)\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/\s+/g, " ").trim();

const fmt = (unix: number, timeZone: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone, ...options }).format(new Date(unix * 1000));
export const dayLong = (unix: number, tz: string) => fmt(unix, tz, { weekday: "long", month: "long", day: "numeric" });
const clock = (unix: number, tz: string, zone = false) => fmt(unix, tz, { hour: "numeric", minute: "2-digit", ...(zone ? { timeZoneName: "short" } : {}) });
const window = (start: number, end: number, tz: string) => `${dayLong(start, tz)}, ${clock(start, tz)} to ${clock(end, tz, true)}`;

const slug = (value: string) => norm(value).replace(/ /g, "-").slice(0, 60);
const roomLevel = (name: string) => name.match(/Level\s*(\d+)/i)?.[0] || (/lobby/i.test(name) ? "hotel lobby" : "");

export interface Delivery { sessionId: number; start: number; end: number; room: string; code?: string; length?: string; level?: string }
export interface SessionGroup { title: string; formats: string[]; speakers: string[]; topics: string[]; description: string; deliveries: Delivery[] }

/** Logistics rows (meals, registration, receptions...) are prose for the consolidation step, not session cards. */
export function isActivity(session: SocioRaw["sessions"][number], speakerComponent: number): boolean {
  const tracks = (session.tracks || []).map((track) => track.name);
  const hasSpeakers = (session.items || []).some((item) => item.componentId === speakerComponent);
  if (tracks.some((track) => /Technical Training (Class|Lab)|Breakout|Roundtable|Quick Takes|Analyst|PAC/i.test(track))) return false;
  return !hasSpeakers;
}

interface TrainingCode { code: string; title: string; day: string; time: string; room: string; length: string; level: string; topics: string }

/** Session codes from the Technical Training reference. */
export function parseTrainingCodes(): TrainingCode[] {
  const { blocks } = readDocument("onedrive/training-session-codes.md");
  const out: TrainingCode[] = [];
  let current: TrainingCode | undefined;
  for (const block of blocks) {
    if (block.kind === "heading" && /^[A-Z]{3}-\d+\s+—/.test(block.text)) {
      const [code, ...rest] = block.text.split(/\s+—\s+/);
      current = { code, title: rest.join(" — "), day: "", time: "", room: "", length: "", level: "", topics: "" };
      out.push(current);
    } else if (current && block.kind === "para") {
      const schedule = block.text.match(/^Schedule:\s*(\w+ \d+)\w*, 2026 \| ([\d:]+ [ap]m) \| (.+)$/i);
      if (schedule) { current.day = schedule[1]; current.time = schedule[2]; current.room = schedule[3]; }
      const length = block.text.match(/^Length:\s*(.+)$/i); if (length) current.length = length[1];
      const level = block.text.match(/^Training level:\s*(.+)$/i); if (level) current.level = level[1];
      const topics = block.text.match(/^Topics:\s*(.+)$/i); if (topics) current.topics = topics[1];
    }
  }
  return out;
}

/** "Rick Scarborough" vs "Richard Scarborough", "Molita Sorisho" vs "Molita Sorishochamaki": same surname/first initial or one surname prefixing the other. */
function sameName(a: string, b: string): boolean {
  const [fa, ...ra] = norm(a).split(" "); const [fb, ...rb] = norm(b).split(" ");
  const la = ra.join(""), lb = rb.join("");
  if (!fa || !fb || !la || !lb) return false;
  return (fa === fb || fa.slice(0, 3) === fb.slice(0, 3)) && (la === lb || la.startsWith(lb) || lb.startsWith(la));
}

interface OneDriveSpeaker { name: string; titleCompany: string; category: string; ciscoCategory: string; bio: string }
function parseOneDriveSpeakers(): Map<string, OneDriveSpeaker> {
  const raw = fs.readFileSync(path.join(DATA_DIR, "onedrive/speakers-sessions-kb.md"), "utf8");
  const start = raw.indexOf("# Speaker Directory");
  const end = raw.indexOf("\n# Session Directory");
  const map = new Map<string, OneDriveSpeaker>();
  for (const block of raw.slice(start, end > start ? end : undefined).split(/\n## /).slice(1)) {
    const name = block.split("\n")[0].trim();
    const field = (label: string) => block.match(new RegExp(`^${label}:\\s*(.+)$`, "m"))?.[1]?.trim() || "";
    const bio = block.match(/^Biography:\s*([\s\S]*?)(?=\n### |\n## |$)/m)?.[1]?.replace(/\s+/g, " ").trim() || "";
    map.set(norm(name), { name, titleCompany: field("Title and company"), category: field("Speaker category"), ciscoCategory: field("Cisco speaker category"), bio });
  }
  return map;
}

export interface StructuredResult { cards: KbCard[]; activityUnits: Array<{ key: string; text: string; source: string }>; report: string[] }

export function buildStructuredCards(): StructuredResult {
  const socio = loadSocio();
  const tz = socio.timezone;
  const report: string[] = [];
  const codes = parseTrainingCodes();
  const odSpeakers = parseOneDriveSpeakers();
  const speakerComponent = socio.componentIds.speakers;
  const topicComponent = socio.componentIds.topics;

  const real = socio.sessions.filter((session) => session.name?.trim() && !isActivity(session, speakerComponent));
  const activities = socio.sessions.filter((session) => session.name?.trim() && isActivity(session, speakerComponent));

  // --- sessions: one card per title, listing every delivery -----------------------------------
  const groups = new Map<string, SessionGroup>();
  for (const session of [...real].sort((a, b) => a.startTime - b.startTime)) {
    const key = norm(session.name.replace(/\s*\(2nd run\)\s*/i, " "));
    const group = groups.get(key) || { title: session.name.replace(/\s*\(2nd run\)\s*/i, "").trim(), formats: [], speakers: [], topics: [], description: "", deliveries: [] };
    groups.set(key, group);
    for (const track of session.tracks || []) if (track.name !== "In-Person" && !group.formats.includes(track.name)) group.formats.push(track.name);
    for (const item of session.items || []) {
      if (item.componentId === speakerComponent && !group.speakers.includes(item.name)) group.speakers.push(item.name);
      if (item.componentId === topicComponent && !group.topics.includes(item.name)) group.topics.push(item.name);
    }
    const description = htmlToText(session.overview);
    if (description.length > group.description.length) group.description = description;
    group.deliveries.push({ sessionId: session.id, start: session.startTime, end: session.endTime, room: session.region?.name || "Room to be announced" });
  }

  // join Technical Training codes (title + date + start time)
  let joined = 0;
  const unmatched: string[] = [];
  for (const code of codes) {
    const group = groups.get(norm(code.title)) || [...groups.values()].find((candidate) => norm(candidate.title) === norm(code.title));
    const delivery = group?.deliveries.find((candidate) => {
      const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "long", day: "numeric" }).format(new Date(candidate.start * 1000));
      const time = clock(candidate.start, tz).toLowerCase().replace(/\s/g, "").replace(/^0/, "");
      return day === code.day && time === code.time.replace(/\s/g, "").replace(/^0/, "");
    });
    if (delivery) { delivery.code = code.code; delivery.length = code.length; delivery.level = code.level.replace(/^Technical Training (Class|Lab):\s*/i, "$1: "); joined++; }
    else unmatched.push(`${code.code} ${code.title} (${code.day} ${code.time})`);
  }
  report.push(`Training codes: ${joined}/${codes.length} joined to Socio sessions.${unmatched.length ? ` Unmatched: ${unmatched.join("; ")}` : ""}`);

  const cards: KbCard[] = [];
  for (const [key, group] of groups) {
    const kindLabel = group.formats.length ? group.formats.join(", ") : "Session";
    const lines = [
      `${group.title} (${kindLabel}).`,
      group.deliveries.length > 1 ? "Scheduled:" : "Scheduled:",
      ...group.deliveries.map((d) => `- ${window(d.start, d.end, tz)} — ${d.room}${d.code ? ` — session code ${d.code}` : ""}${d.length ? ` — ${d.length}` : ""}${d.level ? ` — ${d.level}` : ""}`),
      ...(group.speakers.length ? [`Speakers: ${group.speakers.join(", ")}.`] : []),
      ...(group.topics.length ? [`Topics: ${group.topics.join(", ")}.`] : []),
      ...(group.description ? [`About: ${group.description}`] : []),
    ];
    const codeAliases = group.deliveries.map((d) => d.code).filter(Boolean) as string[];
    cards.push({
      id: `session-${slug(key)}`,
      kind: group.formats.some((format) => /Technical Training/i.test(format)) ? "training" : "session",
      title: group.title,
      text: lines.join("\n"),
      questions: [`Where is ${group.title}?`, `When is ${group.title}?`, `What time does ${group.title} start?`, `Who is speaking at ${group.title}?`, `What is ${group.title} about?`],
      sources: ["socio", ...(codeAliases.length ? ["onedrive/training-session-codes"] : [])],
      days: [...new Set(group.deliveries.map((d) => dayLong(d.start, tz).toLowerCase()))],
      rooms: [...new Set(group.deliveries.map((d) => d.room.toLowerCase()))],
      aliases: [...codeAliases, ...group.speakers],
    });
  }

  // --- speakers -----------------------------------------------------------------------------------
  const sessionsBySpeaker = new Map<number, SocioRaw["sessions"]>();
  for (const session of real) for (const item of session.items || []) if (item.componentId === speakerComponent) sessionsBySpeaker.set(item.id, [...(sessionsBySpeaker.get(item.id) || []), session]);
  let enriched = 0;
  const matchedOd = new Set<string>();
  for (const speaker of socio.speakers.filter((item) => item.name?.trim()).sort((a, b) => a.name.localeCompare(b.name))) {
    const od = odSpeakers.get(norm(speaker.name)) || [...odSpeakers.values()].find((candidate) => sameName(candidate.name, speaker.name));
    if (od) { enriched++; matchedOd.add(norm(od.name)); }
    const title = htmlToText(speaker.info) || od?.titleCompany || "";
    const bio = htmlToText(speaker.overview) || od?.bio || "";
    const appearances = [...(sessionsBySpeaker.get(speaker.id) || [])].sort((a, b) => a.startTime - b.startTime);
    const lines = [
      `${speaker.name.trim()}${title ? ` — ${title.replace(/\s*\|\s*/g, ", ")}` : ""}.`,
      ...(od?.category ? [`Category: ${od.category}${od.ciscoCategory ? ` (${od.ciscoCategory})` : ""}.`] : []),
      ...(bio ? [`Bio: ${bio}`] : []),
      appearances.length ? `Speaking at:\n${appearances.map((s) => `- ${s.name.trim()} — ${window(s.startTime, s.endTime, tz)} — ${s.region?.name || "room to be announced"}`).join("\n")}` : "No sessions listed yet.",
    ];
    cards.push({
      id: `speaker-${slug(speaker.name)}-${speaker.id}`, kind: "speaker", title: speaker.name.trim(), text: lines.join("\n"),
      questions: [`Who is ${speaker.name.trim()}?`, `When is ${speaker.name.trim()} speaking?`, `What sessions is ${speaker.name.trim()} in?`, `Where is ${speaker.name.trim()} speaking?`],
      sources: ["socio", ...(od ? ["onedrive/speakers-sessions-kb"] : [])],
      days: [...new Set(appearances.map((s) => dayLong(s.startTime, tz).toLowerCase()))],
      rooms: [...new Set(appearances.map((s) => (s.region?.name || "").toLowerCase()).filter(Boolean))],
      aliases: [...new Set([speaker.name.trim(), ...(od && norm(od.name) !== norm(speaker.name) ? [od.name] : [])])],
    });
  }
  const odOnly = [...odSpeakers.values()].filter((candidate) => !matchedOd.has(norm(candidate.name)));
  for (const od of odOnly) {
    cards.push({
      id: `speaker-${slug(od.name)}-od`, kind: "speaker", title: od.name, sources: ["onedrive/speakers-sessions-kb"], aliases: [od.name],
      text: [`${od.name}${od.titleCompany ? ` — ${od.titleCompany}` : ""}.`, ...(od.category ? [`Category: ${od.category}.`] : []), ...(od.bio ? [`Bio: ${od.bio}`] : []), "No sessions listed yet."].join("\n"),
      questions: [`Who is ${od.name}?`, `When is ${od.name} speaking?`],
    });
  }
  report.push(`Speakers: ${socio.speakers.length} from Socio, ${enriched} matched to the OneDrive directory (category/bio fallback, name variants kept as aliases); ${odOnly.length} OneDrive-only speaker(s) added: ${odOnly.map((o) => o.name).join(", ") || "none"}.`);

  // --- rooms (skip sponsor booths: the name is the only information they carry) -----------------------
  const sessionsByRoom = new Map<string, SocioRaw["sessions"]>();
  for (const session of socio.sessions) if (session.name?.trim() && session.region?.name) sessionsByRoom.set(session.region.name, [...(sessionsByRoom.get(session.region.name) || []), session]);
  const capacities = new Map(socio.rooms.map((room) => [room.name, room.maxCapacity]));
  for (const name of new Set([...socio.rooms.map((room) => room.name), ...sessionsByRoom.keys()])) {
    if (/^(Bronze|Silver|Gold|Platinum) Sponsor:/i.test(name)) continue;
    const held = [...(sessionsByRoom.get(name) || [])].sort((a, b) => a.startTime - b.startTime);
    const level = roomLevel(name);
    const lines = [
      `${name}${level && !/Level/i.test(name) ? ` (${level})` : ""}.`,
      ...(capacities.get(name) ? [`Capacity: ${capacities.get(name)}.`] : []),
      held.length ? `Scheduled here:\n${held.map((s) => `- ${window(s.startTime, s.endTime, tz)}: ${s.name.trim()}`).join("\n")}` : "Nothing is scheduled in this space.",
    ];
    cards.push({ id: `room-${slug(name)}`, kind: "room", title: name, text: lines.join("\n"), questions: [`Where is ${name.split(",")[0]}?`, `What is happening in ${name.split(",")[0]}?`, `What floor is ${name.split(",")[0]} on?`], sources: ["socio"], rooms: [name.toLowerCase()], days: [...new Set(held.map((s) => dayLong(s.startTime, tz).toLowerCase()))] });
  }

  // --- activities -> prose units for consolidation ----------------------------------------------------
  // Same title can mean a different audience (Lunch for Training Pass holders vs for everyone), so group by both.
  const audienceOf = (session: (typeof activities)[number]) => {
    const tracks = (session.tracks || []).map((track) => track.name);
    if (tracks.includes("Training")) return "Technical Training Pass holders only";
    if (tracks.includes("HIDDEN")) return "";
    return "All attendees";
  };
  const byTitle = new Map<string, typeof activities>();
  for (const activity of activities) {
    const key = `${norm(activity.name)}|${audienceOf(activity)}`;
    byTitle.set(key, [...(byTitle.get(key) || []), activity]);
  }
  const activityUnits = [...byTitle.values()].map((items) => {
    const first = items[0];
    const description = htmlToText(first.overview);
    const audience = audienceOf(first);
    return {
      key: `${first.name.trim()}${audience ? ` (${audience})` : ""}`,
      source: "socio",
      text: `${first.name.trim()}.${audience ? `\nWho it is for: ${audience}.` : ""}\n${items.sort((a, b) => a.startTime - b.startTime).map((s) => `- ${window(s.startTime, s.endTime, tz)} — ${s.region?.name || "Room to be announced"}`).join("\n")}${description ? `\n${description}` : ""}`,
    };
  });
  report.push(`Socio: ${real.length} sessions → ${groups.size} session/training cards (deduplicated by title); ${activities.length} logistics rows → ${activityUnits.length} activity units for consolidation; ${socio.rooms.length} rooms.`);
  return { cards, activityUnits, report };
}
