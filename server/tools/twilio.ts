export const twilioTools = [
  {
    type: "function" as const,
    name: "twilio_sms",
    description: "Send an SMS text message to a specific phone number. Use this when the user asks you to send a text message.",
    parameters: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "The destination phone number to send the SMS to, in E.164 format (e.g., +1234567890).",
        },
        body: {
          type: "string",
          description: "The content of the text message to send.",
        },
      },
      required: ["to", "body"],
    },
  },
];

export async function sms(args: Record<string, any>): Promise<{ success: boolean; result?: string; error?: string }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromPhone = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromPhone) {
    return { success: false, error: "Twilio credentials are not configured" };
  }

  const { to, body } = args;

  try {
    console.log(`Sending Twilio SMS to ${to}...`);
    
    // dynamically import twilio to avoid top-level issues
    const twilioModule = (await import("twilio")).default;
    const client = twilioModule(accountSid, authToken);
    
    const message = await client.messages.create({
      body,
      from: fromPhone,
      to,
    });

    console.log(`SMS sent successfully. SID: ${message.sid}`);
    return { 
      success: true, 
      result: `SMS successfully sent to ${to}. Reference ID: ${message.sid}` 
    };
  } catch (error: any) {
    console.error("Twilio SMS exception:", error);
    return { success: false, error: error.message || "Failed to send SMS" };
  }
}
