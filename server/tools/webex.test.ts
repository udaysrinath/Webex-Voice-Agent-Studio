import assert from "node:assert/strict";

process.env.WEBEX_ACCESS_TOKEN = "test-webex-token";
process.env.WEBEX_SPACE_ID = "active-demo-room";

const { message } = await import("./webex");

const sentRooms: string[] = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = (async (_input, init) => {
  const payload = JSON.parse(String(init?.body || "{}"));
  sentRooms.push(payload.roomId);
  return new Response(JSON.stringify({ id: "message-123" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

try {
  const defaultResult = await message({ message: "general Webex message" });
  assert.equal(defaultResult.success, true);

  const managerResult = await message({
    message: "store manager summary",
    roomId: "explicit-room-id",
  });
  assert.equal(managerResult.success, true);

  assert.deepEqual(sentRooms, ["active-demo-room", "explicit-room-id"]);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Webex room override regression passed");
