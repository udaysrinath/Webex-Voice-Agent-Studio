import assert from "node:assert/strict";
import test from "node:test";
import { HrLiveToolCoordinator } from "./hr-live-tools";

const call = (id: string, name: string) => ({
  delegation_id: "delegation-1", event: { type: "response.output_item.done",
    item: { type: "function_call", call_id: id, name, arguments: "{}" } },
});
const completed = { delegation_id: "delegation-1", event: { type: "response.completed", response: { id: "response-1" } } };

test("waits for all calls, submits before hang-up, and continues exactly once", async () => {
  const actions: string[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const coordinator = new HrLiveToolCoordinator({
    execute: async (item) => { actions.push(item.name); if (item.name === "hr_submit_feedback") await pending; return { success: true }; },
    result: (item) => { actions.push("result:" + item.call_id); },
    continue: () => { actions.push("continue"); }, error: (message) => { throw new Error(message); },
  });
  await coordinator.handle(call("end", "voice_end_call"));
  await coordinator.handle(call("submit", "hr_submit_feedback"));
  await coordinator.handle(call("submit", "hr_submit_feedback"));
  assert.deepEqual(actions, []);
  const processing = coordinator.handle(completed);
  await coordinator.handle(completed);
  assert.deepEqual(actions, ["hr_submit_feedback"]);
  release();
  await processing;
  assert.deepEqual(actions, ["hr_submit_feedback", "result:submit", "voice_end_call", "result:end", "continue"]);
  await coordinator.handle(completed);
  assert.equal(actions.filter((action) => action === "continue").length, 1);
});

test("returns failed tool results without stranding backend continuation", async () => {
  const results: unknown[] = [];
  let continuations = 0;
  const coordinator = new HrLiveToolCoordinator({
    execute: async () => ({ success: false, error: "Webex delivery failed" }),
    result: (_call, result) => { results.push(result); },
    continue: () => { continuations++; }, error: assert.fail,
  });
  await coordinator.handle(call("submit", "hr_submit_feedback"));
  await coordinator.handle(completed);
  assert.deepEqual(results, [{ success: false, error: "Webex delivery failed" }]);
  assert.equal(continuations, 1);
});

test("recovers calls from completed output without repeating a completed response", async () => {
  let executions = 0;
  let continuations = 0;
  const coordinator = new HrLiveToolCoordinator({
    execute: async () => { executions++; return { success: true }; },
    result: () => {}, continue: () => { continuations++; }, error: assert.fail,
  });
  const event = { ...completed, event: { ...completed.event, response: {
    id: "response-1", output: [call("submit", "hr_submit_feedback").event.item],
  } } };
  await coordinator.handle(event);
  await coordinator.handle(event);
  assert.equal(executions, 1);
  assert.equal(continuations, 1);
});

test("disposal cancels late results and nested errors are surfaced", async () => {
  const errors: string[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const coordinator = new HrLiveToolCoordinator({
    execute: async () => { await pending; return { success: true }; },
    result: () => assert.fail("late result"), continue: () => assert.fail("late continuation"),
    error: (message) => { errors.push(message); },
  });
  await coordinator.handle({ event: { type: "response.failed", response: { error: { message: "Backend timed out" } } } });
  assert.deepEqual(errors, ["Backend timed out"]);
  await coordinator.handle(call("submit", "hr_submit_feedback"));
  const processing = coordinator.handle(completed);
  coordinator.dispose(); release();
  await processing;
});
