import assert from "node:assert/strict";

import {
  WEBEXONE_TOOL_GUIDANCE, WebexOneToolInputError, executeWebexOneTool, isWebexOneTool,
  webexOneChatTools, webexOneRealtimeTools, webexOneToolNames,
} from "../../server/webexone-tools";

assert.deepEqual([...webexOneToolNames].sort(), ["get_webexone_live_stats", "search_webexone_reference"]);

// One registry feeds every flow, so both wire formats must describe the same tools.
assert.deepEqual(webexOneRealtimeTools.map((tool) => tool.name), webexOneChatTools.map((tool) => tool.type === "function" ? tool.function.name : ""));
for (const tool of webexOneRealtimeTools) {
  assert.equal(tool.type, "function");
  assert.equal((tool.parameters as { type: string }).type, "object");
  assert.ok(tool.description.length > 40, `${tool.name} needs a description the model can route on`);
  assert.ok(WEBEXONE_TOOL_GUIDANCE.includes(tool.name), `${tool.name} must be covered by the shared prompt guidance`);
}
assert.equal(isWebexOneTool("get_webexone_live_stats"), true);
assert.equal(isWebexOneTool("retail_lookup_order"), false);

await assert.rejects(executeWebexOneTool("send_sms", {}), WebexOneToolInputError);
await assert.rejects(executeWebexOneTool("search_webexone_reference", { query: "x" }), WebexOneToolInputError);
await assert.rejects(executeWebexOneTool("search_webexone_reference", {}), WebexOneToolInputError);
await assert.rejects(executeWebexOneTool("get_webexone_live_stats", { room: "x".repeat(201) }), WebexOneToolInputError);

delete process.env.OPENAI_API_KEY;
assert.match(await executeWebexOneTool("search_webexone_reference", { query: "Which room is the Tom Brady closing keynote in?" }), /Tom Brady/);
assert.match(await executeWebexOneTool("search_webexone_reference", { query: "qzxv wjkl" }), /Do not guess/);

delete process.env.SOCIO_API_KEY;
assert.match(await executeWebexOneTool("get_webexone_live_stats", {}), /not configured/, "unconfigured live data degrades to a message, not a crash");

console.info("webexone tools tests passed");
