import assert from "node:assert/strict";

import { clearSocioCache, htmlToText, socioPaginate } from "../../../server/socio/client";
import { getWebexOneLiveStats, LIVE_INTENT } from "../../../server/socio/live";
import { retrieveWebexOne } from "../../../server/webexone-kb";

const TZ = "America/Chicago";
const start = Date.UTC(2026, 9, 7, 14, 0) / 1000; // 9:00 AM CDT on Oct 7, 2026

assert.equal(htmlToText("<p>a&nbsp;b</p><p>c</p>"), "a b c");

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

// The consolidated knowledge base answers room questions offline (lexical ranking, no embeddings key needed)
delete process.env.OPENAI_API_KEY;
const closingKeynote = await retrieveWebexOne("Which room is the Tom Brady closing keynote in?");
assert.match(closingKeynote.text, /Tom Brady/);
assert.match(closingKeynote.text, /Manchester Ballroom/);
const lunch = await retrieveWebexOne("Where is lunch served?");
assert.match(lunch.text, /Pool Terrace & Palm Court/);

console.info("socio tests passed");
