import { getWebexProfile } from "../webex-profile";

export const webexTools = [
  {
    type: "function" as const,
    name: "webex_message",
    description: "Send a message to the configured Webex space. Use this when the user asks you to send a message to Webex.",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "The message content to send.",
        },
      },
      required: ["message"],
    },
  },
];

export function sanitizeText(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2013/g, '-')
    .replace(/\u2014/g, '--')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ');
}

export async function message(args: Record<string, any>): Promise<{ success: boolean; result?: string; error?: string }> {
  const webexProfile = getWebexProfile();
  const token = webexProfile.bearerToken;
  if (!token) {
    return { success: false, error: "Webex is not configured" };
  }

  const { message: rawMessage } = args;
  const messageContent = sanitizeText(rawMessage);
  const requestedRoomId = typeof args.roomId === "string" ? args.roomId.trim() : "";
  const roomId = requestedRoomId || webexProfile.webexSpaceId;

  if (!roomId) {
    return { 
      success: false, 
      error: "No WebexSpaceId is configured. Please set a WebexSpaceId in your profile." 
    };
  }

  try {
    console.log("Sending Webex message to configured space:", roomId);
    
    const response = await fetch('https://webexapis.com/v1/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        roomId,
        markdown: messageContent,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMsg = response.statusText;
      try {
        const errorData = JSON.parse(errorText);
        errorMsg = errorData.message || errorData.errors?.[0]?.description || response.statusText;
      } catch {}
      return { 
        success: false, 
        error: `Webex error (${response.status}): ${errorMsg}` 
      };
    }

    return { 
      success: true, 
      result: "Message successfully sent to the configured Webex space" 
    };
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to send message" };
  }
}
