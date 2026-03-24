import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertAgentSchema, insertEvaluationSchema } from "@shared/schema";
import { fromError } from "zod-validation-error";
import OpenAI from "openai";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import multer from "multer";
import { createClient } from "@deepgram/sdk";

const upload = multer({ 
  dest: os.tmpdir(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string, 
  headers: Record<string, string>, 
  maxRetries: number = 3
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, { headers });
      
      if (response.status === 502 || response.status === 503 || response.status === 504) {
        console.log(`Webex API returned ${response.status}, retrying in ${(attempt + 1) * 2}s...`);
        await sleep((attempt + 1) * 2000);
        continue;
      }
      
      return response;
    } catch (error: any) {
      lastError = error;
      console.log(`Network error, retrying in ${(attempt + 1) * 2}s...`, error.message);
      await sleep((attempt + 1) * 2000);
    }
  }
  
  throw lastError || new Error('Max retries exceeded');
}

async function paginateGet(
  endpoint: string,
  params: Record<string, string>,
  token: string,
  maxPages: number = 100
): Promise<any[]> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
  
  const baseUrl = 'https://webexapis.com/v1';
  let url: string | null = `${baseUrl}/${endpoint}?${new URLSearchParams(params).toString()}`;
  
  const allItems: any[] = [];
  let page = 0;
  
  while (url && page < maxPages) {
    const response: Response = await fetchWithRetry(url, headers);
    if (!response.ok) {
      throw new Error(`Webex API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    const items = data.items || [];
    allItems.push(...items);
    
    const linkHeader: string | null = response.headers.get('Link');
    url = null;
    if (linkHeader) {
      const nextMatch: RegExpMatchArray | null = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      if (nextMatch) {
        url = nextMatch[1];
      }
    }
    page++;
  }
  
  return allItems;
}

function getOpenAIClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

function getDeepgramClient() {
  if (!process.env.DEEPGRAM_API_KEY) {
    return null;
  }
  return createClient(process.env.DEEPGRAM_API_KEY);
}

const ttsRequestSchema = z.object({
  text: z.string().min(1).max(4096),
  voice: z.enum(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]),
  model: z.enum(["tts-1", "tts-1-hd"]).default("tts-1"),
});

export async function registerRoutes(app: Express): Promise<Server> {

  app.get("/api/deepgram/key", async (_req, res) => {
    try {
      const deepgram = getDeepgramClient();
      if (!deepgram) {
        return res.status(503).json({ 
          error: "Deepgram is not configured. Please add your DEEPGRAM_API_KEY." 
        });
      }

      const { result, error } = await deepgram.manage.createProjectKey(
        process.env.DEEPGRAM_PROJECT_ID || "",
        {
          comment: "Temporary streaming key",
          scopes: ["usage:write"],
          time_to_live_in_seconds: 60,
        }
      );

      if (error) {
        console.error("Deepgram key creation error:", error);
        return res.json({ key: process.env.DEEPGRAM_API_KEY });
      }

      res.json({ key: result?.key || process.env.DEEPGRAM_API_KEY });
    } catch (error: any) {
      console.error("Deepgram key error:", error);
      res.json({ key: process.env.DEEPGRAM_API_KEY });
    }
  });
  
  app.post("/api/transcribe", upload.single('audio'), async (req, res) => {
    let tempFilePath: string | null = null;
    
    try {
      const openai = getOpenAIClient();
      if (!openai) {
        return res.status(503).json({ 
          error: "Transcription is not configured. Please add your OpenAI API key." 
        });
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "No audio file provided" });
      }

      console.log('Received audio file:', {
        originalName: file.originalname,
        size: file.size,
        mimetype: file.mimetype,
      });

      const originalName = file.originalname || 'recording.webm';
      const extension = path.extname(originalName) || '.webm';
      tempFilePath = file.path + extension;
      
      fs.renameSync(file.path, tempFilePath);
      
      const stats = fs.statSync(tempFilePath);
      console.log('Temp file size:', stats.size, 'bytes');

      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tempFilePath),
        model: "whisper-1",
        language: "en",
        temperature: 0,
      });
      
      console.log('Transcription result:', transcription.text);

      res.json({ text: transcription.text });
    } catch (error: any) {
      console.error("Transcription Error:", error);
      if (error.status === 401) {
        return res.status(401).json({ error: "Invalid OpenAI API key" });
      }
      res.status(500).json({ error: "Failed to transcribe audio" });
    } finally {
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch (e) {
        }
      }
      if (req.file && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
        }
      }
    }
  });
  
  app.post("/api/agents", async (req, res) => {
    try {
      const data = insertAgentSchema.parse(req.body);
      const agent = await storage.createAgent(data);
      res.json(agent);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ error: fromError(error).toString() });
      }
      res.status(500).json({ error: "Failed to create agent" });
    }
  });

  app.get("/api/agents", async (_req, res) => {
    try {
      const agents = await storage.getAllAgents();
      res.json(agents);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch agents" });
    }
  });

  app.get("/api/agents/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid agent ID" });
      }
      const agent = await storage.getAgent(id);
      if (!agent) {
        return res.status(404).json({ error: "Agent not found" });
      }
      res.json(agent);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch agent" });
    }
  });

  app.put("/api/agents/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid agent ID" });
      }
      const existingAgent = await storage.getAgent(id);
      if (!existingAgent) {
        return res.status(404).json({ error: "Agent not found" });
      }
      const data = insertAgentSchema.partial().parse(req.body);
      const agent = await storage.updateAgent(id, data);
      res.json(agent);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ error: fromError(error).toString() });
      }
      res.status(500).json({ error: "Failed to update agent" });
    }
  });

  app.delete("/api/agents/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid agent ID" });
      }
      const deleted = await storage.deleteAgent(id);
      if (!deleted) {
        return res.status(404).json({ error: "Agent not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete agent" });
    }
  });

  app.post("/api/evaluations", async (req, res) => {
    try {
      const data = insertEvaluationSchema.parse(req.body);
      const evaluation = await storage.createEvaluation(data);
      res.json(evaluation);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ error: fromError(error).toString() });
      }
      res.status(500).json({ error: "Failed to create evaluation" });
    }
  });

  app.get("/api/evaluations/agent/:agentId", async (req, res) => {
    try {
      const agentId = parseInt(req.params.agentId);
      if (isNaN(agentId)) {
        return res.status(400).json({ error: "Invalid agent ID" });
      }
      const evaluations = await storage.getEvaluationsByAgent(agentId);
      res.json(evaluations);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch evaluations" });
    }
  });

  app.get("/api/knowledge-base/agent/:agentId", async (req, res) => {
    try {
      const agentId = parseInt(req.params.agentId);
      if (isNaN(agentId)) return res.status(400).json({ error: "Invalid agent ID" });
      const items = await storage.getKnowledgeBaseItemsByAgent(agentId);
      res.json(items);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch knowledge base items" });
    }
  });

  const kbUpload = multer({ dest: os.tmpdir(), limits: { fileSize: 10 * 1024 * 1024 } });

  app.post("/api/knowledge-base/url", async (req, res) => {
    try {
      const schema = z.object({ agentId: z.number(), url: z.string().url() });
      const { agentId, url } = schema.parse(req.body);

      const parsed = new URL(url);
      const privatePatterns = [
        /^localhost$/i,
        /^127\./,
        /^10\./,
        /^172\.(1[6-9]|2[0-9]|3[01])\./,
        /^192\.168\./,
        /^0\./,
        /^::1$/,
        /^fc00:/i,
        /^fe80:/i,
      ];
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return res.status(400).json({ error: "Only http and https URLs are allowed." });
      }
      if (privatePatterns.some((p) => p.test(parsed.hostname))) {
        return res.status(400).json({ error: "Private or local URLs are not allowed." });
      }

      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; VoiceAgentStudio/1.0)" },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        return res.status(400).json({ error: `Could not fetch URL: ${response.status} ${response.statusText}` });
      }

      const html = await response.text();
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim()
        .slice(0, 50000);

      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : new URL(url).hostname;

      const item = await storage.createKnowledgeBaseItem({ agentId, type: "url", title, content: text, sourceUrl: url });
      res.json(item);
    } catch (error: any) {
      if (error.name === "ZodError") return res.status(400).json({ error: fromError(error).toString() });
      res.status(500).json({ error: error.message || "Failed to fetch URL" });
    }
  });

  app.post("/api/knowledge-base/file", kbUpload.single("file"), async (req, res) => {
    let tempFilePath: string | null = null;
    try {
      const agentId = parseInt(req.body.agentId);
      if (isNaN(agentId)) return res.status(400).json({ error: "Invalid agent ID" });

      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file provided" });

      tempFilePath = file.path;
      const originalName = file.originalname || "uploaded_file";
      const ext = path.extname(originalName).toLowerCase();

      let content = "";
      if (ext === ".pdf") {
        const { default: pdfParse } = await import("pdf-parse");
        const dataBuffer = fs.readFileSync(tempFilePath);
        const pdfData = await pdfParse(dataBuffer);
        content = pdfData.text.trim().slice(0, 50000);
      } else {
        content = fs.readFileSync(tempFilePath, "utf-8").trim().slice(0, 50000);
      }

      const title = path.basename(originalName, ext) || "Uploaded File";
      const item = await storage.createKnowledgeBaseItem({ agentId, type: "file", title, content, sourceUrl: null });
      res.json(item);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to process file" });
    } finally {
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath); } catch {}
      }
    }
  });

  app.post("/api/knowledge-base/text", async (req, res) => {
    try {
      const schema = z.object({
        agentId: z.number(),
        title: z.string().min(1).max(200),
        content: z.string().min(1).max(50000),
      });
      const { agentId, title, content } = schema.parse(req.body);
      const item = await storage.createKnowledgeBaseItem({ agentId, type: "text", title, content, sourceUrl: null });
      res.json(item);
    } catch (error: any) {
      if (error.name === "ZodError") return res.status(400).json({ error: fromError(error).toString() });
      res.status(500).json({ error: "Failed to save text" });
    }
  });

  app.delete("/api/knowledge-base/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const deleted = await storage.deleteKnowledgeBaseItem(id);
      if (!deleted) return res.status(404).json({ error: "Item not found" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete knowledge base item" });
    }
  });

  app.post("/api/tts", async (req, res) => {
    try {
      const openai = getOpenAIClient();
      if (!openai) {
        return res.status(503).json({ 
          error: "Text-to-speech is not configured. Please add your OpenAI API key." 
        });
      }

      const data = ttsRequestSchema.parse(req.body);
      
      const mp3 = await openai.audio.speech.create({
        model: data.model,
        voice: data.voice,
        input: data.text,
      });

      const buffer = Buffer.from(await mp3.arrayBuffer());
      const base64Audio = buffer.toString("base64");

      res.json({ 
        audio: base64Audio,
        contentType: "audio/mpeg"
      });
    } catch (error: any) {
      console.error("TTS Error:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ error: fromError(error).toString() });
      }
      if (error.status === 401) {
        return res.status(401).json({ error: "Invalid OpenAI API key" });
      }
      res.status(500).json({ error: "Failed to generate speech" });
    }
  });

  app.get("/api/webex/rooms", async (_req, res) => {
    try {
      const rooms = await storage.getAllWebexRooms();
      res.json(rooms);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch Webex rooms" });
    }
  });

  app.get("/api/webex/messages", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 1000;
      const messages = await storage.getAllWebexMessages(limit);
      res.json(messages);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch Webex messages" });
    }
  });

  app.get("/api/webex/stats", async (_req, res) => {
    try {
      const rooms = await storage.getAllWebexRooms();
      const messageCount = await storage.getWebexMessageCount();
      res.json({
        roomCount: rooms.length,
        messageCount,
        hasToken: !!process.env.WEBEX_ACCESS_TOKEN,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch Webex stats" });
    }
  });

  const syncRequestSchema = z.object({
    days: z.number().min(1).max(365).default(15),
  });

  const chatMessageSchema = z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
  });

  const chatRequestSchema = z.object({
    message: z.string().min(1).max(4096),
    systemPrompt: z.string().optional(),
    agentId: z.number().optional(),
    history: z.array(chatMessageSchema).optional(),
  });

  app.post("/api/webex/sync", async (req, res) => {
    try {
      const token = process.env.WEBEX_ACCESS_TOKEN;
      if (!token) {
        return res.status(503).json({ 
          error: "Webex is not configured. Please add your Webex access token." 
        });
      }

      const { days } = syncRequestSchema.parse(req.body || {});
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      console.log(`Syncing Webex messages from last ${days} days...`);

      const rooms = await paginateGet('rooms', { max: '100' }, token, 5);
      console.log(`Found ${rooms.length} rooms`);

      const activeRooms = rooms.filter((room: any) => {
        if (!room.lastActivity) return false;
        const lastActivity = new Date(room.lastActivity);
        return lastActivity >= startDate;
      });

      console.log(`${activeRooms.length} rooms have recent activity`);

      let totalMessages = 0;

      for (const room of activeRooms) {
        await storage.upsertWebexRoom({
          id: room.id,
          title: room.title || 'Untitled',
          type: room.type || 'group',
          lastActivity: room.lastActivity ? new Date(room.lastActivity) : null,
        });

        const messages = await paginateGet(
          'messages',
          { roomId: room.id, max: '100' },
          token,
          5
        );

        for (const msg of messages) {
          if (!msg.created) continue;
          const createdDate = new Date(msg.created);
          if (createdDate < startDate) continue;

          const text = msg.text || msg.html || '';
          if (!text) continue;

          await storage.upsertWebexMessage({
            id: msg.id,
            roomId: room.id,
            text,
            personEmail: msg.personEmail || null,
            personName: msg.personDisplayName || null,
            createdAt: createdDate,
          });
          totalMessages++;
        }
      }

      console.log(`Synced ${totalMessages} messages from ${activeRooms.length} rooms`);

      res.json({
        success: true,
        roomsSynced: activeRooms.length,
        messagesSynced: totalMessages,
      });
    } catch (error: any) {
      console.error("Webex Sync Error:", error);
      res.status(500).json({ error: error.message || "Failed to sync Webex messages" });
    }
  });

  const sendMessageSchema = z.object({
    roomId: z.string().min(1),
    text: z.string().optional(),
    markdown: z.string().optional(),
  }).refine(data => data.text || data.markdown, {
    message: "Either text or markdown must be provided",
  });

  app.post("/api/webex/messages", async (req, res) => {
    try {
      const token = process.env.WEBEX_ACCESS_TOKEN;
      if (!token) {
        return res.status(503).json({ 
          error: "Webex is not configured. Please add your Webex access token." 
        });
      }

      const data = sendMessageSchema.parse(req.body);

      const response = await fetch('https://webexapis.com/v1/messages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          roomId: data.roomId,
          ...(data.markdown ? { markdown: data.markdown } : { text: data.text }),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("Webex API error:", response.status, errorData);
        return res.status(response.status).json({ 
          error: `Webex API error: ${response.status} ${response.statusText}` 
        });
      }

      const result = await response.json();
      res.json({ success: true, message: result });
    } catch (error: any) {
      console.error("Send Message Error:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ error: fromError(error).toString() });
      }
      res.status(500).json({ error: error.message || "Failed to send message" });
    }
  });

  const webexTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "send_webex_message",
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
    },
  ];

  // Sanitize Unicode characters that cause issues with Node.js fetch
  function sanitizeText(text: string): string {
    return text
      .replace(/[\u2018\u2019]/g, "'")  // Curly single quotes to straight
      .replace(/[\u201C\u201D]/g, '"')  // Curly double quotes to straight
      .replace(/\u2013/g, '-')          // En dash to hyphen
      .replace(/\u2014/g, '--')         // Em dash to double hyphen
      .replace(/\u2026/g, '...')        // Ellipsis to three dots
      .replace(/\u00A0/g, ' ');         // Non-breaking space to regular space
  }

  async function executeWebexFunction(
    functionName: string,
    args: Record<string, any>
  ): Promise<{ success: boolean; result?: string; error?: string }> {
    const token = process.env.WEBEX_ACCESS_TOKEN;
    if (!token) {
      return { success: false, error: "Webex is not configured" };
    }

    if (functionName === "send_webex_message") {
      const { roomTitle, message: rawMessage } = args;
      const message = sanitizeText(rawMessage);
      
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
        console.log("Message content:", JSON.stringify(message));
        
        const response = await fetch('https://webexapis.com/v1/messages', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            roomId: matchedRoom.id,
            text: message,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error("Webex send message error - Status:", response.status);
          console.error("Webex send message error - Response:", errorText);
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

        console.log("Message sent successfully to", matchedRoom.title);
        return { 
          success: true, 
          result: `Message successfully sent to "${matchedRoom.title}"` 
        };
      } catch (error: any) {
        console.error("Webex send message exception:", error);
        return { success: false, error: error.message || "Failed to send message" };
      }
    }

    return { success: false, error: `Unknown function: ${functionName}` };
  }

  app.post("/api/chat", async (req, res) => {
    try {
      const openai = getOpenAIClient();
      if (!openai) {
        return res.status(503).json({ 
          error: "Chat is not configured. Please add your OpenAI API key." 
        });
      }

      const data = chatRequestSchema.parse(req.body);
      
      const webexMessages = await storage.getAllWebexMessages(100);
      const webexRooms = await storage.getAllWebexRooms();
      
      let contextMessages = "";
      if (webexMessages.length > 0) {
        contextMessages = webexMessages
          .reverse()
          .slice(0, 50)
          .map(msg => {
            const date = new Date(msg.createdAt).toLocaleDateString();
            return `[${date}] ${msg.personName || 'Unknown'}: ${msg.text}`;
          })
          .join("\n");
      }
      
      let roomsList = "";
      if (webexRooms.length > 0) {
        roomsList = webexRooms.map((r: { title: string }) => `- ${r.title}`).join("\n");
      }

      let kbSection = "";
      if (data.agentId) {
        const kbItems = await storage.getKnowledgeBaseItemsByAgent(data.agentId);
        if (kbItems.length > 0) {
          const kbContent = kbItems.map(item => `### ${item.title}\n${item.content}`).join("\n\n");
          kbSection = `\n\n## Knowledge Base:\nUse this information to answer questions accurately:\n\n${kbContent}`;
        }
      }
      
      const systemContent = data.systemPrompt || "You are a helpful AI assistant.";
      const contextSection = contextMessages 
        ? `\n\n## Recent Webex Messages (Knowledge Base):\nUse these messages as context to provide relevant and personalized responses:\n\n${contextMessages}` 
        : "";
      const roomsSection = roomsList
        ? `\n\n## Available Webex Rooms:\nYou can send messages to these rooms when asked:\n${roomsList}`
        : "";
      
      const messages: Array<OpenAI.Chat.Completions.ChatCompletionMessageParam> = [
        {
          role: "system",
          content: systemContent + kbSection + contextSection + roomsSection,
        },
      ];
      
      if (data.history && data.history.length > 0) {
        for (const msg of data.history) {
          messages.push({
            role: msg.role,
            content: msg.content,
          });
        }
      }
      
      messages.push({
        role: "user",
        content: data.message,
      });
      
      const hasWebex = !!process.env.WEBEX_ACCESS_TOKEN && webexRooms.length > 0;
      
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages,
        max_tokens: 500,
        tools: hasWebex ? webexTools : undefined,
        tool_choice: hasWebex ? "auto" : undefined,
      });

      const assistantMessage = completion.choices[0]?.message;
      
      if (assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0) {
        const toolCall = assistantMessage.tool_calls[0] as { id: string; type: string; function: { name: string; arguments: string } };
        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments);
        
        const functionResult = await executeWebexFunction(functionName, functionArgs);
        
        messages.push(assistantMessage);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(functionResult),
        });
        
        const followUpCompletion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages,
          max_tokens: 500,
        });
        
        const response = followUpCompletion.choices[0]?.message?.content || 
          (functionResult.success 
            ? `Done! ${functionResult.result}` 
            : `Sorry, there was an issue: ${functionResult.error}`);
        
        res.json({ response });
      } else {
        const response = assistantMessage?.content || "I'm sorry, I couldn't generate a response.";
        res.json({ response });
      }
    } catch (error: any) {
      console.error("Chat Error:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ error: fromError(error).toString() });
      }
      if (error.status === 401) {
        return res.status(401).json({ error: "Invalid OpenAI API key" });
      }
      res.status(500).json({ error: "Failed to generate response" });
    }
  });

  const anamSessionSchema = z.object({
    agentId: z.number().optional(),
    personaConfig: z.object({
      name: z.string().optional(),
      personaId: z.string().optional(),
      avatarId: z.string().optional(),
      voiceId: z.string().optional(),
      llmId: z.string().optional(),
      systemPrompt: z.string().optional(),
    }).optional(),
  });

  app.post("/api/anam/session-token", async (req, res) => {
    try {
      const apiKey = process.env.ANAM_API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: "Anam AI is not configured. Please add your ANAM_API_KEY.",
        });
      }

      const data = anamSessionSchema.parse(req.body || {});

      let enrichedSystemPrompt = data.personaConfig?.systemPrompt || "You are a helpful AI assistant. Reply in natural speech without formatting.";

      if (data.agentId) {
        const kbItems = await storage.getKnowledgeBaseItemsByAgent(data.agentId);
        if (kbItems.length > 0) {
          const kbContent = kbItems.map(item => `### ${item.title}\n${item.content}`).join("\n\n");
          enrichedSystemPrompt += `\n\n## Knowledge Base:\nUse this information to answer questions accurately:\n\n${kbContent}`;
        }
      }

      const webexMessages = await storage.getAllWebexMessages(100);
      const webexRooms = await storage.getAllWebexRooms();

      if (webexMessages.length > 0) {
        const contextMessages = webexMessages
          .reverse()
          .slice(0, 50)
          .map(msg => {
            const date = new Date(msg.createdAt).toLocaleDateString();
            return `[${date}] ${msg.personName || 'Unknown'}: ${msg.text}`;
          })
          .join("\n");

        enrichedSystemPrompt += `\n\n## Recent Webex Messages (Knowledge Base):\nUse these messages as context to provide relevant and personalized responses:\n\n${contextMessages}`;
      }

      if (webexRooms.length > 0) {
        const roomsList = webexRooms.map((r: { title: string }) => `- ${r.title}`).join("\n");
        enrichedSystemPrompt += `\n\n## Available Webex Rooms:\n${roomsList}`;
      }

      const response = await fetch("https://api.anam.ai/v1/auth/session-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          personaConfig: data.personaConfig?.personaId
            ? { personaId: data.personaConfig.personaId }
            : {
                name: data.personaConfig?.name || "Assistant",
                avatarId: data.personaConfig?.avatarId || "30fa96d0-26c4-4e55-94a0-517025942e18",
                voiceId: data.personaConfig?.voiceId || "6bfbe25a-979d-40f3-a92b-5394170af54b",
                llmId: data.personaConfig?.llmId || "0934d97d-0c3a-4f33-91b0-5e136a0ef466",
                systemPrompt: enrichedSystemPrompt,
              },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Anam API error:", response.status, errorText);
        return res.status(response.status).json({
          error: `Anam API error: ${response.status} ${response.statusText}`,
        });
      }

      const result = await response.json();
      const sessionToken = result.sessionToken || result.token || result.session_token;
      if (!sessionToken) {
        console.error("Unexpected Anam API response:", JSON.stringify(result));
        return res.status(500).json({ error: "Invalid response from Anam API" });
      }
      res.json({ sessionToken });
    } catch (error: any) {
      console.error("Anam session token error:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ error: fromError(error).toString() });
      }
      res.status(500).json({ error: "Failed to create Anam session token" });
    }
  });

  app.get("/api/anam/status", async (_req, res) => {
    res.json({ configured: !!process.env.ANAM_API_KEY });
  });

  const httpServer = createServer(app);

  return httpServer;
}
