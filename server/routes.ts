import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertAgentSchema, insertEvaluationSchema } from "@shared/schema";
import { fromError } from "zod-validation-error";
import OpenAI from "openai";
import { z } from "zod";

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
    const response: Response = await fetch(url, { headers });
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

const ttsRequestSchema = z.object({
  text: z.string().min(1).max(4096),
  voice: z.enum(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]),
  model: z.enum(["tts-1", "tts-1-hd"]).default("tts-1"),
});

export async function registerRoutes(app: Express): Promise<Server> {
  
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
    days: z.number().min(1).max(365).default(30),
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

      const rooms = await paginateGet('rooms', { max: '100' }, token, 10);
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
          10
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
      
      const systemContent = data.systemPrompt || "You are a helpful AI assistant.";
      const contextSection = contextMessages 
        ? `\n\n## Recent Webex Messages (Knowledge Base):\nUse these messages as context to provide relevant and personalized responses:\n\n${contextMessages}` 
        : "";
      
      const messages: Array<{role: "system" | "user" | "assistant", content: string}> = [
        {
          role: "system",
          content: systemContent + contextSection,
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
      
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages,
        max_tokens: 500,
      });

      const response = completion.choices[0]?.message?.content || "I'm sorry, I couldn't generate a response.";

      res.json({ response });
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

  const httpServer = createServer(app);

  return httpServer;
}
