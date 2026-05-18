export type CallChannel = "twilio" | "browser";

export type CallLifecycleState =
  | "starting"
  | "active"
  | "waiting_for_tool"
  | "wrap_up"
  | "post_call"
  | "ended";

export interface CallStateChange {
  previousState: CallLifecycleState;
  state: CallLifecycleState;
  reason: string;
  timestamp: number;
}

export class CallSession {
  readonly id: string;
  readonly channel: CallChannel;
  readonly startedAt: number;
  private state: CallLifecycleState = "starting";
  private activeToolCount = 0;

  constructor(channel: CallChannel, id = `${channel}-${Date.now()}`) {
    this.channel = channel;
    this.id = id;
    this.startedAt = Date.now();
  }

  get lifecycleState(): CallLifecycleState {
    return this.state;
  }

  activate(reason = "Call started"): CallStateChange | null {
    return this.transition("active", reason);
  }

  beginTool(toolName: string): CallStateChange | null {
    this.activeToolCount++;
    if (this.state !== "active") return null;
    return this.transition("waiting_for_tool", `Tool started: ${toolName}`);
  }

  finishTool(toolName: string): CallStateChange | null {
    this.activeToolCount = Math.max(0, this.activeToolCount - 1);
    if (this.state !== "waiting_for_tool" || this.activeToolCount > 0) return null;
    return this.transition("active", `Tool completed: ${toolName}`);
  }

  startWrapUp(reason: string): CallStateChange | null {
    if (this.state === "ended" || this.state === "post_call" || this.state === "wrap_up") {
      return null;
    }
    this.activeToolCount = 0;
    return this.transition("wrap_up", reason);
  }

  startPostCall(reason = "Post-call work started"): CallStateChange | null {
    if (this.state === "ended" || this.state === "post_call") return null;
    return this.transition("post_call", reason);
  }

  end(reason = "Call ended"): CallStateChange | null {
    this.activeToolCount = 0;
    if (this.state === "ended") return null;
    return this.transition("ended", reason);
  }

  canAcceptToolOutput(): boolean {
    return this.state === "active" || this.state === "waiting_for_tool";
  }

  canPromptCaller(): boolean {
    return this.state === "active";
  }

  isEndingOrEnded(): boolean {
    return this.state === "wrap_up" || this.state === "post_call" || this.state === "ended";
  }

  private transition(nextState: CallLifecycleState, reason: string): CallStateChange | null {
    if (this.state === nextState) return null;
    const previousState = this.state;
    this.state = nextState;
    return {
      previousState,
      state: nextState,
      reason,
      timestamp: Date.now(),
    };
  }
}
