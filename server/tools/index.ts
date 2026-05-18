import * as webex from "./webex";
import * as twilio from "./twilio";
import * as retail from "./retail";
import type { ToolExecutionContext } from "./tool-context";

export type ToolExecutionResult = {
  success: boolean;
  result?: string;
  error?: string;
  data?: unknown;
  durationMs?: number;
};

const DEFAULT_TOOL_TIMEOUT_MS = 8000;

// Combine tools from all providers that are configured
export const realtimeTools = [
  ...retail.retailTools,
  ...webex.webexTools,
  ...(twilio.isSmsConfigured() ? twilio.twilioTools : []),
];

// Map for chat completion format
export const chatTools: any[] = realtimeTools.map(t => ({
  type: t.type,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }
}));

const providers: Record<string, any> = {
  retail,
  webex,
  twilio,
};

export async function executeTool(
  name: string,
  args: Record<string, any>,
  context: ToolExecutionContext = {}
): Promise<ToolExecutionResult> {
  const startedAt = Date.now();
  // Split tool name based on the convention: {provider}_{function}
  // e.g., "webex_message" -> provider: "webex", function: "message"
  const parts = name.split('_');
  const providerName = parts[0];
  const functionName = parts.slice(1).join('_');

  const provider = providers[providerName];
  if (!provider) {
    return withToolMetadata(startedAt, { success: false, error: `Provider not found for tool: ${name}` });
  }

  const fn = provider[functionName];
  if (!fn || typeof fn !== 'function') {
    return withToolMetadata(startedAt, { success: false, error: `Function not found for tool: ${name}` });
  }

  try {
    const result = await withTimeout(
      Promise.resolve(fn(args, context)),
      getToolTimeoutMs(name),
      `Tool ${name} timed out`
    );
    return withToolMetadata(startedAt, result);
  } catch (error: any) {
    console.error(`Tool execution error [${name}]:`, error);
    return withToolMetadata(startedAt, {
      success: false,
      error: error.message || "Failed to execute tool",
    });
  }
}

function getToolTimeoutMs(name: string): number {
  const specific = Number(process.env[`TOOL_TIMEOUT_MS_${name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`]);
  if (Number.isFinite(specific) && specific > 0) return specific;

  const global = Number(process.env.TOOL_TIMEOUT_MS);
  if (Number.isFinite(global) && global > 0) return global;

  return DEFAULT_TOOL_TIMEOUT_MS;
}

function withToolMetadata(
  startedAt: number,
  result: Omit<ToolExecutionResult, "durationMs"> & { durationMs?: number }
): ToolExecutionResult {
  return {
    ...result,
    durationMs: result.durationMs ?? Date.now() - startedAt,
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
