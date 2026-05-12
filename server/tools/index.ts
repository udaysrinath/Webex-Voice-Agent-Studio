import * as webex from "./webex";
import * as twilio from "./twilio";
import * as retail from "./retail";

// Combine tools from all providers that are configured
export const realtimeTools = [
  ...retail.retailTools,
  ...(process.env.WEBEX_ACCESS_TOKEN ? webex.webexTools : []),
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
  args: Record<string, any>
): Promise<{ success: boolean; result?: string; error?: string; data?: unknown }> {
  // Split tool name based on the convention: {provider}_{function}
  // e.g., "webex_message" -> provider: "webex", function: "message"
  const parts = name.split('_');
  const providerName = parts[0];
  const functionName = parts.slice(1).join('_');

  const provider = providers[providerName];
  if (!provider) {
    return { success: false, error: `Provider not found for tool: ${name}` };
  }

  const fn = provider[functionName];
  if (!fn || typeof fn !== 'function') {
    return { success: false, error: `Function not found for tool: ${name}` };
  }

  try {
    return await fn(args);
  } catch (error: any) {
    console.error(`Tool execution error [${name}]:`, error);
    return { success: false, error: error.message || "Failed to execute tool" };
  }
}
