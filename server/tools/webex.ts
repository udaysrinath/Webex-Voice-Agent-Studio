import { storage } from "../storage";

export const webexTools = [
  {
    type: "function" as const,
    name: "webex_message",
    description: "Send a message to a Webex space/room. Use this when the user asks you to send a message to a Webex room or space.",
    parameters: {
      type: "object",
      properties: {
        roomTitle: {
          type: "string",
          description: "The title/name of the Webex room to send the message to. Match this to available rooms.",
        },
        message: {
          type: "string",
          description: "The message content to send.",
        },
      },
      required: ["roomTitle", "message"],
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
  const token = process.env.WEBEX_ACCESS_TOKEN;
  if (!token) {
    return { success: false, error: "Webex is not configured" };
  }

  const { roomTitle, message: rawMessage } = args;
  const messageContent = sanitizeText(rawMessage);
  
  const rooms = await storage.getAllWebexRooms();
  const matchedRoom = rooms.find(
    (r: { title: string }) => r.title.toLowerCase().includes(roomTitle.toLowerCase()) || 
           roomTitle.toLowerCase().includes(r.title.toLowerCase())
  );
  
  if (!matchedRoom) {
    const availableRooms = rooms.slice(0, 10).map((r: { title: string }) => r.title).join(", ");
    return { 
      success: false, 
      error: `Could not find a room matching "${roomTitle}". Available rooms: ${availableRooms}` 
    };
  }

  try {
    console.log("Sending Webex message to room:", matchedRoom.title, "roomId:", matchedRoom.id);
    
    const response = await fetch('https://webexapis.com/v1/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        roomId: matchedRoom.id,
        text: messageContent,
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
      result: `Message successfully sent to "${matchedRoom.title}"` 
    };
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to send message" };
  }
}
