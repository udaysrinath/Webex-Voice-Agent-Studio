export interface HrLiveToolCall { type: string; call_id: string; name: string; arguments?: string; }

// Wait for the entire delegated response before executing/continuing it.
// Execute submission before hang-up if the backend emitted both together.
export class HrLiveToolCoordinator {
  private batches = new Map<string, { calls: Map<string, HrLiveToolCall>; running: boolean }>();
  private results = new Map<string, unknown>();
  private completedResponses = new Set<string>();
  private disposed = false;
  constructor(private callbacks: {
    execute: (call: HrLiveToolCall) => Promise<unknown>;
    result: (call: HrLiveToolCall, result: unknown) => void;
    continue: () => void;
    error: (message: string) => void;
  }) {}

  async handle(envelope: any): Promise<void> {
    if (this.disposed) return;
    const event = envelope?.event;
    // Delegation IDs persist across continuations; retain only the current batch.
    const delegation = String(envelope?.delegation_id || "hr");
    if (event?.type === "error" || event?.type === "response.failed" || event?.type === "response.incomplete") {
      this.callbacks.error(event.error?.message || event.response?.error?.message || "HR backend continuation failed.");
      return;
    }
    if (event?.type === "response.created") {
      this.batches.set(delegation, { calls: new Map(), running: false });
      return;
    }
    let batch = this.batches.get(delegation);
    if (event?.type === "response.output_item.done" && event.item?.type === "function_call") {
      batch ??= { calls: new Map(), running: false };
      this.batches.set(delegation, batch);
      batch.calls.set(String(event.item.call_id), event.item);
      return;
    }
    if (event?.type !== "response.completed") return;
    const responseId = event.response?.id;
    if (responseId && this.completedResponses.has(responseId)) return;
    // The completed response also carries output items. Use it as a fallback
    // if an individual output_item.done event was missed.
    for (const item of event.response?.output || []) {
      if (item.type !== "function_call") continue;
      batch ??= { calls: new Map(), running: false };
      this.batches.set(delegation, batch);
      batch.calls.set(String(item.call_id), item);
    }
    if (!batch?.calls.size || batch.running) return;
    if (responseId) this.completedResponses.add(responseId);
    batch.running = true;
    try {
      const calls = [...batch.calls.values()].sort((a, b) =>
        Number(b.name === "hr_submit_feedback") - Number(a.name === "hr_submit_feedback"));
      for (const call of calls) {
        if (this.disposed) return;
        let result = this.results.get(call.call_id);
        if (!this.results.has(call.call_id)) {
          result = await this.callbacks.execute(call);
          if (this.disposed) return;
          this.results.set(call.call_id, result);
        }
        this.callbacks.result(call, result);
      }
      if (!this.disposed) this.callbacks.continue();
    } catch (cause) {
      this.callbacks.error(cause instanceof Error ? cause.message : "HR tool continuation failed.");
    } finally {
      if (this.batches.get(delegation) === batch) this.batches.delete(delegation);
    }
  }
  dispose(): void { this.disposed = true; this.batches.clear(); this.results.clear(); this.completedResponses.clear(); }
}
