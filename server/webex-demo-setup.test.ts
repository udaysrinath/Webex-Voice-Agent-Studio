import assert from "node:assert/strict";

import { setupWebexDemoSession, WebexDemoSetupError } from "./webex-demo-setup";
import type { WebexProfile } from "./webex-profile";

type FetchCall = {
  url: string;
  init?: RequestInit;
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
    statusText: init.statusText,
  });
}

const createdRooms: string[] = [];
const fetchCalls: FetchCall[] = [];
let updatedProfile: WebexProfile | undefined;

const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  fetchCalls.push({ url, init });

  if (url.includes("/rooms?")) {
    return jsonResponse({ items: [] });
  }

  if (url.endsWith("/rooms") && init?.method === "POST") {
    const payload = JSON.parse(String(init.body));
    createdRooms.push(payload.title);
    return jsonResponse({
      id: "room-demo-123",
      title: payload.title,
      type: "group",
    });
  }

  if (url.endsWith("/memberships") && init?.method === "POST") {
    const payload = JSON.parse(String(init.body));
    assert.equal(payload.roomId, "room-demo-123");
    assert.equal(payload.personEmail, "tester@example.com");
    return jsonResponse({ id: "membership-123" });
  }

  if (url.endsWith("/messages") && init?.method === "POST") {
    const payload = JSON.parse(String(init.body));
    assert.equal(payload.roomId, "room-demo-123");
    assert.match(payload.markdown, /tester@example\.com/i);
    assert.match(payload.markdown, /Reservation confirmations/i);
    assert.doesNotMatch(payload.markdown, /\bJohn\b/i);
    return jsonResponse({ id: "message-123" });
  }

  throw new Error(`Unexpected fetch: ${url}`);
};

const result = await setupWebexDemoSession(
  { webexEmail: " tester@example.com " },
  {
    fetchImpl: fakeFetch,
    getProfile: () => ({ bearerToken: "server-token" }),
    updateProfile: (update) => {
      updatedProfile = update;
      return { bearerToken: "server-token", ...update };
    },
  }
);

assert.equal(result.success, true);
assert.equal(result.roomId, "room-demo-123");
assert.equal(result.roomTitle, "Cisco Live Voice Agent Demo - tester@example.com");
assert.equal(result.webexEmail, "tester@example.com");
assert.equal(result.createdRoom, true);
assert.equal(result.membershipStatus, "added");
assert.equal(result.messageSent, true);
assert.deepEqual(updatedProfile, { webexSpaceId: "room-demo-123" });
assert.deepEqual(createdRooms, ["Cisco Live Voice Agent Demo - tester@example.com"]);
assert.equal(fetchCalls.length, 4);

await assert.rejects(
  () => setupWebexDemoSession(
    { webexEmail: "tester@example.com" },
    { getProfile: () => ({}) }
  ),
  (error) => error instanceof WebexDemoSetupError && error.statusCode === 503
);

console.log("Webex email demo setup regression passed");
