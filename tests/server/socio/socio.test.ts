import assert from "node:assert/strict";

import { clearSocioCache, htmlToText, socioPaginate } from "../../../server/socio/client";
import { getWebexOneLiveStats, LIVE_INTENT } from "../../../server/socio/live";
import { renderAgendaMarkdown, renderRoomsMarkdown, renderSpeakersMarkdown, type SnapshotSession } from "../../../server/socio/snapshot";
import { findWebexOneExcerpts } from "../../../server/webexone-knowledge";

const ids = { speakers: 500985, topics: 500984 };
const TZ = "America/Chicago";
const start = Date.UTC(2026, 9, 7, 14, 0) / 1000; // 9:00 AM CDT on Oct 7, 2026

const sessions: SnapshotSession[] = [
  {
    id: 1, name: "Opening Keynote", overview: "<div>Hear from <strong>leaders</strong> &amp; partners.</div>", startTime: start, endTime: start + 5400,
    region: { name: "Manchester Ballroom, Level 5" }, tracks: [{ name: "Keynote" }], component: { name: "Agenda" },
    items: [{ id: 10, name: "Tom Brady", componentId: 500985 }, { id: 20, name: "AI", componentId: 500984 }],
  },
  {
    id: 2, name: "Hands-on Lab", overview: null, startTime: start + 86400, endTime: start + 90000,
    region: { name: "Violet, Level 4" }, tracks: null, component: null, items: null,
  },
];

const agenda = renderAgendaMarkdown(sessions, ids, TZ);
assert.match(agenda, /^## Wednesday, October 7$/m);
assert.match(agenda, /^## Thursday, October 8$/m);
assert.match(agenda, /- When: Wednesday, October 7, 9:00 AM CDT to 10:30 AM CDT/);
assert.match(agenda, /- Room: Manchester Ballroom, Level 5/);
assert.match(agenda, /- Speakers: Tom Brady/);
assert.match(agenda, /- Topics: AI/);
assert.match(agenda, /- Description: Hear from leaders & partners\./);
assert.equal(renderAgendaMarkdown(sessions, ids, TZ), agenda, "rendering must be deterministic");

const speakerMarkdown = renderSpeakersMarkdown(
  [{ id: 10, name: "Tom Brady", info: "Champion", overview: null }, { id: 11, name: "Ada Lovelace", info: null, overview: null }],
  sessions, ids, TZ,
);
assert.match(speakerMarkdown, /### Tom Brady\n- Title: Champion\n- Sessions: Opening Keynote \(Wednesday, October 7, 9:00 AM CDT, Manchester Ballroom, Level 5\)/);
assert.match(speakerMarkdown, /### Ada Lovelace\n- Sessions: none listed yet/);
assert.ok(speakerMarkdown.indexOf("### Ada Lovelace") < speakerMarkdown.indexOf("### Tom Brady"), "speakers sorted by name");
assert.equal(htmlToText("<p>a&nbsp;b</p><p>c</p>"), "a b c");

const roomsMarkdown = renderRoomsMarkdown([{ name: "Violet, Level 4", maxCapacity: 40 }, { name: "Empty Room", maxCapacity: null }], sessions, TZ);
assert.match(roomsMarkdown, /### Manchester Ballroom, Level 5\n- Wednesday, October 7, 9:00 AM CDT to 10:30 AM CDT: Opening Keynote/);
assert.match(roomsMarkdown, /### Violet, Level 4\n- Capacity: 40\n- Thursday, October 8, 9:00 AM CDT to 10:00 AM CDT: Hands-on Lab/);
assert.match(roomsMarkdown, /### Empty Room\n- No sessions scheduled/);

assert.equal(LIVE_INTENT.test("How many people are checked in right now?"), true);
assert.equal(LIVE_INTENT.test("Is the opening keynote full?"), true);
assert.equal(LIVE_INTENT.test("Where is the hotel?"), false);

// Mocked Socio API
process.env.SOCIO_API_KEY = "test-key";
process.env.SOCIO_EVENT_ID = "60274";
const requests: string[] = [];
let failNext = false;
const nowMs = (start + 1800) * 1000; // 30 minutes into the keynote

const attendance = (total: number, now: number, capacity: number) => ({ total, currentlyCheckedIn: now, allTimeCheckedIn: now + 5, checkedOut: 5, capacity, remainingCapacity: capacity > 0 ? capacity - now : -1 });
const liveNodes = [
  { id: 1, name: "Opening Keynote", startTime: start, endTime: start + 5400, checkinStatus: "open", region: { name: "Manchester Ballroom, Level 5" }, attendance: attendance(294, 180, 300), items: [{ name: "Tom Brady", componentId: 500985 }, { name: "AI", componentId: 500984 }] },
  { id: 2, name: "Hands-on Lab", startTime: start + 86400, endTime: start + 90000, checkinStatus: "open", region: { name: "Violet, Level 4" }, attendance: attendance(20, 0, -1), items: [] },
  { id: 3, name: "Breakfast", startTime: start - 7200, endTime: start - 1800, checkinStatus: "open", region: { name: "Pool Terrace" }, attendance: attendance(10, 0, -1), items: [] },
];

globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
  const { query } = JSON.parse(init?.body || "{}");
  requests.push(query);
  if (failNext) { failNext = false; return new Response("nope", { status: 500 }); }
  if (query.includes("eventMetrics")) return Response.json({ data: { eventMetrics: { checkinCount: 1204, activeUsersCount: 1307 } } });
  if (query.includes("componentsConnection")) return Response.json({ data: { componentsConnection: { nodes: [{ id: 500985, name: "Speakers" }, { id: 500984, name: "Topics" }] } } });
  if (query.includes("sessionsConnection")) return Response.json({ data: { sessionsConnection: { pageInfo: { endCursor: null, hasNextPage: false }, nodes: liveNodes } } });
  return Response.json({ errors: [{ message: "unexpected query" }] });
}) as typeof fetch;

clearSocioCache();
const eventWide = await getWebexOneLiveStats({}, nowMs);
assert.match(eventWide, /1204 attendees checked in so far; 1307 active users/);
assert.doesNotMatch(eventWide, /Opening Keynote/);
assert.equal(requests.some((query) => query.includes("sessionsConnection")), false, "event-wide lookups must not fetch sessions");

const keynote = await getWebexOneLiveStats({ session: "opening keynote" }, nowMs);
assert.match(keynote, /"Opening Keynote" \| Manchester Ballroom, Level 5 \| .* \| in progress \| registered: 294 \| checked in now: 180 \| total ever checked in: 185 \| capacity: 300 \| seats left: 120/);
assert.doesNotMatch(keynote, /Hands-on Lab/);

const byRoom = await getWebexOneLiveStats({ room: "Violet" }, nowMs);
assert.match(byRoom, /"Hands-on Lab" .* upcoming .* capacity: no limit set \| seats left: not applicable/);

const bySpeaker = await getWebexOneLiveStats({ speaker: "Tom Brady" }, nowMs);
assert.match(bySpeaker, /"Opening Keynote"/);

const best = await getWebexOneLiveStats({ session: "hands lab breakfast" }, nowMs);
assert.match(best, /Matching sessions \(1\)/, "only the best-scoring matches are returned");
assert.match(best, /Hands-on Lab/);

const ordered = await getWebexOneLiveStats({ session: "keynote lab breakfast" }, nowMs);
assert.ok(ordered.indexOf("Opening Keynote") < ordered.indexOf("Hands-on Lab") && ordered.indexOf("Hands-on Lab") < ordered.indexOf("Breakfast"), "in progress, then upcoming, then finished");

assert.match(await getWebexOneLiveStats({ session: "zzzz nothing" }, nowMs), /No sessions matched/);
assert.doesNotMatch(await getWebexOneLiveStats({ query: "how many people are checked in" }, nowMs), /Matching sessions/, "stopword-only chat queries stay event-wide");

assert.equal(requests.some((query) => /attendeesConnection|attendee\(|customFieldAnswers|netSales/.test(query)), false, "live lookups must never request attendee records or revenue");

clearSocioCache();
failNext = true;
const failed = await getWebexOneLiveStats({}, nowMs);
assert.match(failed, /temporarily unavailable/);
assert.doesNotMatch(failed, /test-key|500/);

delete process.env.SOCIO_API_KEY;
clearSocioCache();
assert.match(await getWebexOneLiveStats({}, nowMs), /not configured/);
process.env.SOCIO_API_KEY = "test-key";

// Pagination follows cursors
clearSocioCache();
const cursors: Array<string | null> = [];
globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
  const { variables } = JSON.parse(init?.body || "{}");
  cursors.push(variables.cursor);
  const first = variables.cursor === null;
  return Response.json({ data: { c: { pageInfo: { endCursor: first ? "next" : null, hasNextPage: first }, nodes: [first ? 1 : 2] } } });
}) as typeof fetch;
assert.deepEqual(await socioPaginate<{ c: any }, number>("query($eventId:Int!,$first:Int,$cursor:String){c}", (data) => data.c), [1, 2]);
assert.deepEqual(cursors, [null, "next"]);

// The generated knowledge base answers room questions offline (keyword search, no embeddings key needed)
delete process.env.OPENAI_API_KEY;
const excerpts = await findWebexOneExcerpts("Which room is the Tom Brady closing keynote in?");
assert.match(excerpts, /Tom Brady/);
assert.match(excerpts, /Room: [^\n|]*Ballroom/);
assert.doesNotMatch(excerpts, /Luminary Fireside Chat/, "the superseded scraped agenda must not be indexed alongside Socio");

console.info("socio tests passed");
