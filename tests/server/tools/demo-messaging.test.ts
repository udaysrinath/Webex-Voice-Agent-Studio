import assert from "node:assert/strict";

process.env.TWILIO_ACCOUNT_SID = "AC00000000000000000000000000000000";
process.env.TWILIO_AUTH_TOKEN = "test-token";
process.env.TWILIO_PHONE_NUMBER = "+15555550100";

const { realtimeTools } = await import("../../../server/tools/index");

assert.equal(
  realtimeTools.some((tool) => tool.name === "twilio_sms"),
  true
);

console.log("demo messaging SMS exposure regression passed");
