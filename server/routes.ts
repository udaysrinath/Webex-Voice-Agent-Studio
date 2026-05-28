import type { Express, Request as ExpressRequest, Response as ExpressResponse } from "express";
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
import { chatTools, executeTool, realtimeTools } from "./tools";
import { getSmsProvider, isSmsConfigured } from "./tools/twilio";
import { buildRetailRuntimePrompt } from "@shared/prompt-builder";
import { VOICE_USE_CASES, isRetailStoreUseCasePrompt } from "@shared/use-cases";
import { getWebexProfile, updateWebexProfile } from "./webex-profile";
import {
  getReservationConfirmationEmailTo,
  isReservationEmailConfigured,
  updateReservationDeliveryProfile,
} from "./voice-agent/reservation-delivery";

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

// --- Provider configuration ---
const CHAT_PROVIDER = process.env.CHAT_PROVIDER || "openai";
const CHAT_MODEL = process.env.CHAT_MODEL || (CHAT_PROVIDER === "groq" ? "llama-3.1-70b-versatile" : "gpt-4o");
const TTS_PROVIDER = process.env.TTS_PROVIDER || "openai";

const DEEPGRAM_VOICE_MAP: Record<string, string> = {
  alloy: "aura-asteria-en",
  echo: "aura-orion-en",
  fable: "aura-arcas-en",
  onyx: "aura-perseus-en",
  nova: "aura-luna-en",
  shimmer: "aura-stella-en",
};

function getChatClient(): OpenAI | null {
  if (CHAT_PROVIDER === "groq") {
    if (!process.env.GROQ_API_KEY) return null;
    return new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
    });
  }
  if (!process.env.OPENAI_API_KEY) return null;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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
  voice: z.string().min(1),
  model: z.enum(["tts-1", "tts-1-hd", "gpt-4o-mini-tts"]).default("tts-1"),
});

const OPENAI_TTS_LEGACY_VOICES = new Set([
  "alloy",
  "ash",
  "coral",
  "echo",
  "fable",
  "onyx",
  "nova",
  "sage",
  "shimmer",
]);

function resolveOpenAITtsModel(model: string, voice: string): string {
  const normalizedVoice = voice.trim().toLowerCase();
  if ((model === "tts-1" || model === "tts-1-hd") && !OPENAI_TTS_LEGACY_VOICES.has(normalizedVoice)) {
    return "gpt-4o-mini-tts";
  }
  return model;
}

function resolveOpenAITtsVoice(voice: string): string {
  return voice.trim().toLowerCase() === "cedar" ? "cedar" : "marin";
}

export async function registerRoutes(app: Express): Promise<Server> {

  // ── Provider config (dynamic LLM + voice options for frontend) ────────────
  app.get("/api/config", (_req, res) => {
    const llmModels = CHAT_PROVIDER === "groq"
      ? [
          { id: "llama-3.1-70b-versatile", name: "Llama 3.1 70B", provider: "Groq", desc: "Fast & versatile" },
          { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B", provider: "Groq", desc: "Ultra-fast responses" },
          { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B", provider: "Groq", desc: "Large context window" },
        ]
      : [
          { id: "gpt-4o", name: "GPT-4o", provider: "OpenAI", desc: "Best for reasoning & nuance" },
          { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "OpenAI", desc: "Fast & cost-effective" },
          { id: "gpt-4-turbo", name: "GPT-4 Turbo", provider: "OpenAI", desc: "High throughput" },
        ];

    const voices = TTS_PROVIDER === "deepgram"
      ? [
          { id: "aura-asteria-en", name: "Asteria", gender: "Female", style: "Warm" },
          { id: "aura-luna-en", name: "Luna", gender: "Female", style: "Soft" },
          { id: "aura-stella-en", name: "Stella", gender: "Female", style: "Expressive" },
          { id: "aura-athena-en", name: "Athena", gender: "Female", style: "Professional" },
          { id: "aura-hera-en", name: "Hera", gender: "Female", style: "Authoritative" },
          { id: "aura-orion-en", name: "Orion", gender: "Male", style: "Deep" },
          { id: "aura-arcas-en", name: "Arcas", gender: "Male", style: "British" },
          { id: "aura-perseus-en", name: "Perseus", gender: "Male", style: "Authoritative" },
          { id: "aura-angus-en", name: "Angus", gender: "Male", style: "Conversational" },
          { id: "aura-orpheus-en", name: "Orpheus", gender: "Male", style: "Natural" },
          { id: "aura-helios-en", name: "Helios", gender: "Male", style: "Energetic" },
          { id: "aura-zeus-en", name: "Zeus", gender: "Male", style: "Commanding" },
        ]
      : [
          { id: "marin", name: "Marin", gender: "Neutral", style: "Best quality" },
          { id: "cedar", name: "Cedar", gender: "Neutral", style: "Best quality" },
        ];

    res.json({
      chatProvider: CHAT_PROVIDER,
      chatModel: CHAT_MODEL,
      ttsProvider: TTS_PROVIDER,
      llmModels,
      voices,
    });
  });

  app.get("/api/use-cases/:id/tools", (req, res) => {
    const useCase = VOICE_USE_CASES.find((item) => item.id === req.params.id);
    if (!useCase) {
      return res.status(404).json({ error: "Use case not found" });
    }

    if (useCase.id !== "retail-customer-cross-store") {
      return res.json([]);
    }

    res.json(
      realtimeTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        provider: tool.name.split("_")[0],
        implemented: true,
      }))
    );
  });

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
      console.error("Agent creation error details:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ error: fromError(error).toString() });
      }
      res.status(500).json({ error: "Failed to create agent", details: error?.message || String(error) });
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
        const { PDFParse } = await import("pdf-parse");
        const dataBuffer = fs.readFileSync(tempFilePath);
        const parser = new PDFParse({ data: dataBuffer });
        try {
          const pdfData = await parser.getText();
          content = pdfData.text.trim().slice(0, 50000);
        } finally {
          await parser.destroy();
        }
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

  app.put("/api/knowledge-base/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const schema = z.object({
        title: z.string().min(1).max(200),
        content: z.string().min(1).max(50000),
      });
      const { title, content } = schema.parse(req.body);
      const item = await storage.updateKnowledgeBaseItem(id, title, content);
      if (!item) return res.status(404).json({ error: "Item not found" });
      res.json(item);
    } catch (error: any) {
      if (error.name === "ZodError") return res.status(400).json({ error: fromError(error).toString() });
      res.status(500).json({ error: "Failed to update item" });
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

  // Spark Builder: generate agent name + system prompt + contextual suggestions + integrations
  app.post("/api/agents/generate-prompt", async (req, res) => {
    try {
      const chatClient = getChatClient();
      if (!chatClient) return res.status(503).json({ error: "Chat provider not configured" });

      const { description } = req.body;
      if (!description?.trim()) return res.status(400).json({ error: "Description required" });

      const completion = await chatClient.chat.completions.create({
        model: CHAT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are an expert AI voice agent designer. Given a user's description of an agent, generate:

1. "agentName" — short, memorable (2-3 words, title case, no "AI"/"Bot" suffix)
2. "agentCategory" — one of: retail, banking, healthcare, support, sales, scheduling, personal, education, travel, other
3. "systemPrompt" — production-ready system prompt with FOUR sections IN THIS ORDER: # Personality, # Capabilities, # Communication Style, # Rules. The # Rules section MUST exist (even if initially empty with a placeholder like "- Follow user instructions carefully.") because user refinements will be appended to it as mandatory behaviors. Under 400 words total.
4. "suggestions" — exactly 5 specific, actionable refinements phrased as user requests, tailored to the agent's category. Examples for a retail agent: "Add rules for handling damaged items", "Create a policy for expedited shipping requests". Make them category-specific, not generic.
5. "suggestedIntegrations" — exactly 3 relevant integration objects, each with "name" and "reason". Pick from this catalog matching the agent's category:
   - Retail: Stripe (payments/refunds), Shopify (product catalog), FedEx/UPS (shipping tracking)
   - Banking: Plaid (account data), Stripe (transactions), Twilio (SMS verification)
   - Healthcare: Google Calendar (appointments), Twilio (reminders), Epic/Cerner (patient records)
   - Support: Zendesk (tickets), Jira (bug tracking), Slack (team alerts)
   - Sales: HubSpot (CRM), Salesforce (pipeline), Calendly (scheduling)
   - Scheduling: Google Calendar, Outlook, Calendly
   - Personal/other: Gmail, Slack, Notion, Zapier
   Pick whichever 3 make the most sense for the described use case.

Return valid JSON only: {"agentName":"...","agentCategory":"...","systemPrompt":"...","suggestions":[...],"suggestedIntegrations":[{"name":"...","reason":"..."},...]}`
          },
          { role: "user", content: description.trim() }
        ],
        response_format: { type: "json_object" },
        max_tokens: 1400
      });

      const raw = completion.choices[0].message.content || "{}";
      const result = JSON.parse(raw);
      if (!result.agentName || !result.systemPrompt) {
        return res.status(500).json({ error: "Generation failed — unexpected format" });
      }
      res.json({
        agentName: result.agentName,
        agentCategory: result.agentCategory || "other",
        systemPrompt: result.systemPrompt,
        suggestions: Array.isArray(result.suggestions) ? result.suggestions.slice(0, 5) : [],
        suggestedIntegrations: Array.isArray(result.suggestedIntegrations) ? result.suggestedIntegrations.slice(0, 3) : []
      });
    } catch (err: any) {
      console.error("[SparkBuilder] generate-prompt error:", err.message);
      res.status(500).json({ error: err.message || "Generation failed" });
    }
  });

  // Spark Builder: refine an existing system prompt based on a follow-up request
  app.post("/api/agents/refine-prompt", async (req, res) => {
    try {
      const chatClient = getChatClient();
      if (!chatClient) return res.status(503).json({ error: "Chat provider not configured" });

      const { systemPrompt, agentName, refinement } = req.body;
      if (!systemPrompt?.trim() || !refinement?.trim()) {
        return res.status(400).json({ error: "systemPrompt and refinement are required" });
      }

      const completion = await chatClient.chat.completions.create({
        model: CHAT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are an expert AI voice agent designer. The user is refining an existing agent. Your PRIMARY JOB is to make sure the refinement becomes a STRICT, ENFORCED behavior of the agent — not a loose suggestion.

CRITICAL RULES FOR APPLYING THE REFINEMENT:
1. The refinement MUST be encoded as one or more imperative numbered rules in a "# Rules" section at the bottom of the system prompt. If a # Rules section does not exist, CREATE IT.
2. Use forceful directive language: "MUST", "ALWAYS", "NEVER", "BEFORE you do X, you MUST first do Y". Do NOT use soft language like "consider", "may", "should" — use "MUST"/"ALWAYS".
3. If the refinement implies a workflow gate (e.g. "verify identity before sharing balances"), write it as: "Before performing <action>, you MUST first <gate>. If <gate> is not satisfied, refuse to proceed and ask for it."
4. If the refinement is about something the user must collect (email, OTP, ID, etc.), explicitly list the steps: "1. Ask the user for <thing>. 2. Wait for them to provide <thing>. 3. Confirm <thing> back to them. 4. Only then proceed."
5. ALSO weave a brief mention into # Capabilities so the model is aware of the new capability/constraint at the top, but the AUTHORITATIVE rule lives in # Rules.
6. PRESERVE all existing rules — never delete prior refinements. Append new ones with the next number.

Then return:
1. "systemPrompt" — full updated prompt with sections: # Personality, # Capabilities, # Communication Style, # Rules
2. "summary" — short one-sentence summary of what you changed
3. "suggestions" — 4 new specific refinement suggestions, different from what was just done
4. "suggestedIntegrations" — up to 2 integration objects with "name" and "reason", only if the refinement strongly implies a new integration would help (e.g. an email-verification refinement → suggest "SendGrid" or "Gmail"). Use Stripe, Shopify, Plaid, Twilio, SendGrid, Google Calendar, HubSpot, Zendesk, Slack, Gmail, Notion, Zapier, Calendly, Salesforce, Jira. Empty array if none apply.

Return valid JSON: {"systemPrompt":"...","summary":"...","suggestions":[...],"suggestedIntegrations":[...]}`
          },
          {
            role: "user",
            content: `Agent name: ${agentName || "the agent"}

Current system prompt:
"""
${systemPrompt}
"""

Already connected integrations: ${(req.body.activeIntegrations || ["Webex", "Retail Database"]).join(", ")}

REFINEMENT REQUESTED BY USER: "${refinement}"

Now produce the updated systemPrompt. REMINDER:
- The output MUST contain a "# Rules" section (create it if missing).
- The refinement above MUST be encoded as one or more numbered, imperative MUST-rules in the # Rules section, using "MUST"/"ALWAYS"/"NEVER".
- If the refinement is a verification or gate (e.g. verify identity by email), spell out the exact step-by-step procedure: ask, wait, confirm, then proceed; refuse to proceed otherwise.
- Preserve any existing rules — append, do not replace.
- Also briefly mention the new behavior in # Capabilities so the agent is aware of it.

Failing to add the refinement as a strict rule in the # Rules section is the worst possible outcome. Be strict.`
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 1400
      });

      const raw = completion.choices[0].message.content || "{}";
      const result = JSON.parse(raw);
      res.json({
        systemPrompt: result.systemPrompt || systemPrompt,
        summary: result.summary || "System prompt updated",
        suggestions: Array.isArray(result.suggestions) ? result.suggestions.slice(0, 4) : [],
        suggestedIntegrations: Array.isArray(result.suggestedIntegrations) ? result.suggestedIntegrations.slice(0, 2) : []
      });
    } catch (err: any) {
      console.error("[SparkBuilder] refine-prompt error:", err.message);
      res.status(500).json({ error: err.message || "Refinement failed" });
    }
  });

  app.post("/api/tts", async (req, res) => {
    try {
      const data = ttsRequestSchema.parse(req.body);

      if (TTS_PROVIDER === "deepgram") {
        const deepgram = getDeepgramClient();
        if (!deepgram) {
          return res.status(503).json({
            error: "Text-to-speech is not configured. Please add your DEEPGRAM_API_KEY."
          });
        }

        const voiceModel = data.voice.startsWith("aura-") ? data.voice : (DEEPGRAM_VOICE_MAP[data.voice] || "aura-asteria-en");
        const response = await deepgram.speak.request(
          { text: data.text },
          { model: voiceModel, encoding: "mp3" }
        );

        const stream = await response.getStream();
        if (!stream) {
          return res.status(500).json({ error: "Failed to generate speech stream" });
        }

        const chunks: Buffer[] = [];
        const reader = stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(Buffer.from(value));
        }
        const buffer = Buffer.concat(chunks);
        const base64Audio = buffer.toString("base64");

        res.json({
          audio: base64Audio,
          contentType: "audio/mpeg"
        });
      } else {
        const openai = getOpenAIClient();
        if (!openai) {
          return res.status(503).json({
            error: "Text-to-speech is not configured. Please add your OPENAI_API_KEY."
          });
        }

        const voice = resolveOpenAITtsVoice(data.voice);
        const model = resolveOpenAITtsModel(data.model, voice);
        const mp3 = await openai.audio.speech.create({
          model,
          voice,
          input: data.text,
        });

        const buffer = Buffer.from(await mp3.arrayBuffer());
        const base64Audio = buffer.toString("base64");

        res.json({
          audio: base64Audio,
          contentType: "audio/mpeg"
        });
      }
    } catch (error: any) {
      console.error("TTS Error:", error);
      if (error.name === "ZodError") {
        return res.status(400).json({ error: fromError(error).toString() });
      }
      if (error.status === 401) {
        return res.status(401).json({ error: "Invalid API key" });
      }
      res.status(500).json({ error: "Failed to generate speech" });
    }
  });

  app.post("/api/ocr", async (req, res) => {
    try {
      const openai = getOpenAIClient();
      if (!openai) {
        return res.status(503).json({ error: "OpenAI API key is not configured." });
      }
      const { image } = req.body;
      if (!image || typeof image !== "string") {
        return res.status(400).json({ error: "Missing image field (base64 data URL)" });
      }
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: image, detail: "high" },
              },
              {
                type: "text",
                text: "Extract and return all visible text from this image exactly as it appears. Preserve line breaks and formatting as much as possible. If there is no text in the image, respond with: [No text detected]",
              },
            ],
          },
        ],
        max_tokens: 2000,
      });
      const text = response.choices[0]?.message?.content?.trim() || "[No text detected]";
      res.json({ text });
    } catch (error: any) {
      console.error("OCR Error:", error);
      res.status(500).json({ error: error.message || "Failed to extract text from image" });
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
      const webexProfile = getWebexProfile();
      res.json({
        roomCount: rooms.length,
        messageCount,
        hasToken: !!webexProfile.bearerToken,
        hasDefaultSpace: !!webexProfile.webexSpaceId,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch Webex stats" });
    }
  });

  const webexProfileSchema = z.object({
    bearerToken: z.string().optional(),
    webexSpaceId: z.string().optional(),
  });

  const demoCustomerSessionSchema = z.object({
    customerEmail: z.string().trim().email().max(254),
  });

  app.get("/api/webex/profile", async (_req, res) => {
    const profile = getWebexProfile();
    res.json({
      hasBearerToken: !!profile.bearerToken,
      webexSpaceId: profile.webexSpaceId || "",
    });
  });

  app.put("/api/webex/profile", async (req, res) => {
    try {
      const data = webexProfileSchema.parse(req.body || {});
      const profile = updateWebexProfile(data);
      res.json({
        success: true,
        hasBearerToken: !!profile.bearerToken,
        webexSpaceId: profile.webexSpaceId || "",
      });
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ error: fromError(error).toString() });
      }
      res.status(500).json({ error: error.message || "Failed to save Webex profile" });
    }
  });

  app.post("/api/demo/customer-session", async (req, res) => {
    try {
      const data = demoCustomerSessionSchema.parse(req.body || {});
      updateReservationDeliveryProfile({ customerEmail: data.customerEmail });
      res.json({
        success: true,
        customerEmail: getReservationConfirmationEmailTo(),
        emailConfigured: isReservationEmailConfigured(),
      });
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ error: fromError(error).toString() });
      }
      res.status(500).json({ error: error.message || "Failed to set up customer confirmation" });
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
      const token = getWebexProfile().bearerToken;
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
    roomId: z.string().optional(),
    text: z.string().optional(),
    markdown: z.string().optional(),
  }).refine(data => data.text || data.markdown, {
    message: "Either text or markdown must be provided",
  });

  app.post("/api/webex/messages", async (req, res) => {
    try {
      const webexProfile = getWebexProfile();
      const token = webexProfile.bearerToken;
      if (!token) {
        return res.status(503).json({ 
          error: "Webex is not configured. Please add your Webex access token." 
        });
      }

      const data = sendMessageSchema.parse(req.body);
      const roomId = data.roomId || webexProfile.webexSpaceId;
      if (!roomId) {
        return res.status(400).json({
          error: "No Webex space configured. Please set a WebexSpaceId in your profile.",
        });
      }

      const response = await fetch('https://webexapis.com/v1/messages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          roomId,
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

  // ─── Customer Database (mock) ─────────────────────────────────────────────
  const CUSTOMER_DB = [
    { name: "Mayada Zakaria", dob: "1985-03-15", phone: "+19195978220", accountBalance: 3750.00, otp: "123456" },
    { name: "John Smith",    dob: "1985-03-15", phone: "+15551234567", accountBalance: 2450.00, otp: "234567" },
    { name: "Jane Doe",      dob: "1990-07-22", phone: "+15559876543", accountBalance: 5820.50, otp: "345678" },
    { name: "Carlos Rivera", dob: "1978-11-08", phone: "+15552223333", accountBalance: 1100.75, otp: "456789" },
    { name: "Emily Chen",    dob: "1995-01-30", phone: "+15554445555", accountBalance: 8300.00, otp: "567890" },
    { name: "Demo User",     dob: "2000-01-01", phone: process.env.DEMO_CUSTOMER_PHONE || "+15550001111", accountBalance: 1000.00, otp: "111111" },
  ];

  // In-memory OTP store: token → { code, expiresAt, phone }
  const otpStore = new Map<string, { code: string; expiresAt: number; phone: string }>();

  function lookupCustomer(name: string, dob: string): typeof CUSTOMER_DB[0] | null {
    const n = name.trim().toLowerCase();
    const d = dob.trim();
    return CUSTOMER_DB.find(c =>
      c.name.toLowerCase() === n && c.dob === d
    ) ?? null;
  }

  function maskPhone(phone: string): string {
    return phone.replace(/(\+\d{1,3})(\d+)(\d{4})$/, (_, cc, mid, last) =>
      `${cc}${"*".repeat(mid.length)}${last}`
    );
  }

  app.post("/api/auth/lookup", (req, res) => {
    const { name, dob } = req.body;
    if (!name || !dob) return res.status(400).json({ error: "name and dob required" });
    const customer = lookupCustomer(name, dob);
    if (!customer) return res.status(404).json({ found: false });
    res.json({ found: true, maskedPhone: maskPhone(customer.phone) });
  });

  app.post("/api/auth/send-code", async (req, res) => {
    const { name, dob } = req.body;
    if (!name || !dob) return res.status(400).json({ error: "name and dob required" });
    const customer = lookupCustomer(name, dob);
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    otpStore.set(token, { code, expiresAt: Date.now() + 10 * 60 * 1000, phone: customer.phone });

    const sid   = process.env.TWILIO_ACCOUNT_SID;
    const auth  = process.env.TWILIO_AUTH_TOKEN;
    const from  = process.env.TWILIO_PHONE_NUMBER;

    if (!sid || !auth || !from) {
      console.warn("Twilio not configured — OTP code (dev only):", code);
      return res.json({ token, maskedPhone: maskPhone(customer.phone), devCode: code });
    }

    try {
      const twilio = (await import("twilio")).default;
      const client = twilio(sid, auth);
      await client.messages.create({
        body: `Your Cisco Bank verification code is: ${code}. Valid for 10 minutes.`,
        from,
        to: customer.phone,
      });
      res.json({ token, maskedPhone: maskPhone(customer.phone) });
    } catch (err: any) {
      console.error("Twilio error:", err);
      res.status(500).json({ error: "Failed to send SMS: " + err.message });
    }
  });

  app.post("/api/auth/verify-code", (req, res) => {
    const { token, code } = req.body;
    if (!token || !code) return res.status(400).json({ error: "token and code required" });
    const entry = otpStore.get(token);
    if (!entry) return res.json({ verified: false, reason: "Invalid or expired session" });
    if (Date.now() > entry.expiresAt) {
      otpStore.delete(token);
      return res.json({ verified: false, reason: "Code expired" });
    }
    if (entry.code !== String(code).trim()) {
      return res.json({ verified: false, reason: "Incorrect code" });
    }
    otpStore.delete(token);
    res.json({ verified: true });
  });

  // ── Avatar-native banking flow helpers ─────────────────────────────────────
  // Extract name+last4 from free-form avatar speech, then send OTP
  app.post("/api/banking/extract-and-send", async (req, res) => {
    const { message, agentId } = req.body;
    if (!message) return res.status(400).json({ error: "message required" });

    const chatClient = getChatClient();
    let name: string | null = null;
    let last4: string | null = null;

    if (chatClient) {
      try {
        const extraction = await chatClient.chat.completions.create({
          model: CHAT_MODEL,
          messages: [
            {
              role: "system",
              content: `Extract a person's full name and the last 4 digits of their card from the following spoken message. The digits may be written as a number like "6789" or spoken as words like "six seven eight nine". Return JSON with keys "name" (string) and "last4" (4-digit string). If you cannot find both, return {"name": null, "last4": null}.`
            },
            { role: "user", content: message }
          ],
          max_tokens: 80,
          response_format: { type: "json_object" }
        });
        const parsed = JSON.parse(extraction.choices[0]?.message?.content || "{}");
        name = parsed.name || null;
        last4 = parsed.last4 ? String(parsed.last4).replace(/\D/g, "").slice(-4) : null;
      } catch (e) {
        console.error("[Banking] extract-and-send LLM error:", e);
      }
    }

    if (!name || !last4 || last4.length !== 4) {
      return res.json({ token: null, response: "I didn't catch that clearly. Could you please tell me your full name and the last 4 digits of your card?" });
    }

    const found = await lookupCustomerFromKB(agentId, name, last4);
    if (!found) {
      return res.json({ token: null, response: `I couldn't find an account matching that name and card number. Please double-check and try again.` });
    }

    // Use OTP from user profile (no Twilio SMS sent)
    const code = found.otp || String(Math.floor(100000 + Math.random() * 900000));
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    otpStore.set(token, { code, expiresAt: Date.now() + 10 * 60 * 1000, phone: found.phone });
    console.log(`[Banking] Profile OTP stored for verification (no SMS sent)`);

    return res.json({
      token,
      maskedPhone: found.maskedPhone,
      response: `Thank you. I've verified your account details. I'm sending you a one-time password now — please provide the verification code when you're ready.`
    });
  });

  // Extract 6-digit OTP code from free-form avatar speech
  app.post("/api/banking/extract-code", async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "message required" });

    const chatClient = getChatClient();
    let code: string | null = null;

    const cleaned = message.replace(/\s+/g, "");
    const directMatch = cleaned.match(/\d{4,8}/);
    if (directMatch) {
      code = directMatch[0];
    } else if (chatClient) {
      try {
        const extraction = await chatClient.chat.completions.create({
          model: CHAT_MODEL,
          messages: [
            { role: "system", content: `Extract a numeric verification code (4 to 8 digits) from this spoken message. The digits may be spoken individually like "two four seven eight nine one". Return JSON: {"code": "247891"} or {"code": null}.` },
            { role: "user", content: message }
          ],
          max_tokens: 40,
          response_format: { type: "json_object" }
        });
        const parsed = JSON.parse(extraction.choices[0]?.message?.content || "{}");
        code = parsed.code ? String(parsed.code).replace(/\D/g, "") : null;
      } catch (e) {
        console.error("[Banking] extract-code LLM error:", e);
      }
    }

    if (!code || code.length !== 6) return res.json({ code: null });
    res.json({ code });
  });
  // ──────────────────────────────────────────────────────────────────────────

  const bankingAuthTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "lookup_customer",
        description: "Look up a customer by their full name and last 4 digits of their card. Returns whether they were found and their masked phone number. Call this after the user provides their name and last 4 card digits.",
        parameters: {
          type: "object",
          properties: {
            name:  { type: "string", description: "Customer full name" },
            last4: { type: "string", description: "Last 4 digits of the customer's card" },
          },
          required: ["name", "last4"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "send_verification_code",
        description: "Send a 6-digit SMS verification code to the phone number on file for the customer. Call this immediately after successfully looking up the customer.",
        parameters: {
          type: "object",
          properties: {
            name:  { type: "string", description: "Customer full name" },
            last4: { type: "string", description: "Last 4 digits of the customer's card" },
          },
          required: ["name", "last4"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "verify_code",
        description: "Verify the 6-digit code the user received by SMS. Returns verified: true if correct. Call this after the user reads you their code.",
        parameters: {
          type: "object",
          properties: {
            token: { type: "string", description: "The session token returned by send_verification_code" },
            code:  { type: "string", description: "The 6-digit code the user provided" },
          },
          required: ["token", "code"],
        },
      },
    },
  ];

  // Levenshtein distance for fuzzy name matching
  function levenshtein(a: string, b: string): number {
    const m = a.length, n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[m][n];
  }

  function namesMatch(csvName: string, inputName: string): boolean {
    const csv   = csvName.trim().toLowerCase();
    const input = inputName.trim().toLowerCase();
    if (csv === input) return true;

    const csvParts   = csv.split(/\s+/);
    const inputParts = input.split(/\s+/);

    // Last name must match exactly
    const csvLast   = csvParts[csvParts.length - 1];
    const inputLast = inputParts[inputParts.length - 1];
    if (csvLast !== inputLast) return false;

    // First name: allow up to 2 character edits (handles "Mayada"→"Mayata", "Mayeda")
    const csvFirst   = csvParts[0];
    const inputFirst = inputParts[0];
    return levenshtein(csvFirst, inputFirst) <= 2;
  }

  // Parse CSV knowledge base content to find a customer by name + last 4 card digits
  async function lookupCustomerFromKB(
    agentId: number | undefined,
    name: string,
    last4: string
  ): Promise<{ phone: string; maskedPhone: string; otp?: string } | null> {
    console.log(`[Banking] lookup: agentId=${agentId}, name="${name}", last4="${last4}"`);
    // First try knowledge base if agentId provided
    if (agentId) {
      const kbItems = await storage.getKnowledgeBaseItemsByAgent(agentId);
      console.log(`[Banking] KB items for agent ${agentId}:`, kbItems.length);
      for (const item of kbItems) {
        if (!item.content) continue;
        const lines = item.content.split('\n').map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          // Skip header rows
          if (/name.*card|card.*name/i.test(line)) continue;
          const parts = line.split(',').map(p => p.trim());
          if (parts.length < 3) continue;
          const csvName  = parts[0];
          const csvLast4 = parts[1].replace(/\D/g, '');
          const csvPhone = parts[2].replace(/\D/g, '');
          const csvOtp   = parts[3] ? parts[3].replace(/\D/g, '') : undefined;
          console.log(`[Banking] Checking CSV row: name="${csvName}" last4="${csvLast4}" phone="${csvPhone}" otp="${csvOtp ?? 'none'}"`);
          if (
            namesMatch(csvName, name) &&
            csvLast4 === last4.replace(/\D/g, '')
          ) {
            const e164 = csvPhone.startsWith('1') ? `+${csvPhone}` : `+1${csvPhone}`;
            console.log(`[Banking] Match found! Phone: ${e164}, OTP in profile: ${csvOtp ?? 'none'}`);
            return { phone: e164, maskedPhone: maskPhone(e164), otp: csvOtp };
          }
        }
      }
      console.log(`[Banking] No KB match found, trying hardcoded DB`);
    }
    // Fallback: hardcoded DB
    const customer = CUSTOMER_DB.find(
      c => namesMatch(c.name, name) &&
           last4.replace(/\D/g,'') === c.phone.slice(-4)
    );
    if (!customer) {
      console.log(`[Banking] No match in hardcoded DB either`);
      return null;
    }
    console.log(`[Banking] Hardcoded DB match: ${customer.phone}`);
    return { phone: customer.phone, maskedPhone: maskPhone(customer.phone), otp: customer.otp };
  }

  async function executeBankingFunction(
    functionName: string,
    args: Record<string, any>,
    agentId?: number
  ): Promise<{ success: boolean; result?: string; error?: string; token?: string; verified?: boolean }> {
    if (functionName === "lookup_customer") {
      const found = await lookupCustomerFromKB(agentId, args.name, args.last4);
      if (!found) return { success: false, error: "No customer found matching that name and card number." };
      return { success: true, result: `Customer found. Phone on file: ${found.maskedPhone}` };
    }

    if (functionName === "send_verification_code") {
      const found = await lookupCustomerFromKB(agentId, args.name, args.last4);
      if (!found) return { success: false, error: "Customer not found." };

      // Use OTP from user profile — no SMS sent
      const code = found.otp || String(Math.floor(100000 + Math.random() * 900000));
      const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      otpStore.set(token, { code, expiresAt: Date.now() + 10 * 60 * 1000, phone: found.phone });
      console.log(`[Banking] Profile OTP stored for chat-flow verification (no SMS sent)`);

      return { success: true, result: `Verification code issued. Please ask the customer to provide their one-time password.`, token };
    }

    if (functionName === "verify_code") {
      const entry = otpStore.get(args.token);
      if (!entry) return { success: true, verified: false, result: "Invalid or expired session token." };
      if (Date.now() > entry.expiresAt) {
        otpStore.delete(args.token);
        return { success: true, verified: false, result: "Code expired. Please request a new one." };
      }
      if (entry.code !== String(args.code).trim()) {
        return { success: true, verified: false, result: "Incorrect code. Please try again." };
      }
      otpStore.delete(args.token);
      return { success: true, verified: true, result: "Identity verified successfully. The customer is authenticated." };
    }

    return { success: false, error: `Unknown banking function: ${functionName}` };
  }

  app.post("/api/chat", async (req, res) => {
    try {
      const chatClient = getChatClient();
      if (!chatClient) {
        return res.status(503).json({
          error: "Chat is not configured. Please set OPENAI_API_KEY or GROQ_API_KEY."
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
      let agentNameForPrompt = "";
      if (data.agentId) {
        const agent = await storage.getAgent(data.agentId);
        agentNameForPrompt = agent?.name || "";
        const kbItems = await storage.getKnowledgeBaseItemsByAgent(data.agentId);
        if (kbItems.length > 0) {
          const kbContent = kbItems.map(item => `### ${item.title}\n${item.content}`).join("\n\n");
          kbSection = `\n\n## Knowledge Base:\nUse this information to answer questions accurately:\n\n${kbContent}`;
        }
      }
      
      let systemContent = data.systemPrompt || "You are a helpful AI assistant.";
      if (isRetailStoreUseCasePrompt(systemContent, agentNameForPrompt)) {
        systemContent = buildRetailRuntimePrompt(systemContent);
      }
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
      
      const webexProfile = getWebexProfile();
      const hasWebex = !!webexProfile.bearerToken && (webexRooms.length > 0 || !!webexProfile.webexSpaceId);
      const bankingFunctionNames = ["lookup_customer", "send_verification_code", "verify_code"];
      const allTools = [
        ...bankingAuthTools,
        ...chatTools,
      ];

      const supportsTools = CHAT_PROVIDER !== "groq";

      const completion = await chatClient.chat.completions.create({
        model: CHAT_MODEL,
        messages,
        max_tokens: 500,
        ...(supportsTools && allTools.length > 0 ? { tools: allTools, tool_choice: "auto" } : {}),
      });

      const assistantMessage = completion.choices[0]?.message;

      if (supportsTools && assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0) {
        let currentAssistantMessage = assistantMessage;
        const toolResults: Array<{ toolName: string; result: Record<string, any> }> = [];
        let verified = false;

        for (let i = 0; i < 4 && currentAssistantMessage?.tool_calls?.length; i++) {
          messages.push(currentAssistantMessage);

          for (const rawToolCall of currentAssistantMessage.tool_calls) {
            const toolCall = rawToolCall as { id: string; type: string; function: { name: string; arguments: string } };
            const functionName = toolCall.function.name;
            const functionArgs = JSON.parse(toolCall.function.arguments || "{}");

            const functionResult: Record<string, any> = bankingFunctionNames.includes(functionName)
              ? await executeBankingFunction(functionName, functionArgs, data.agentId)
              : await executeTool(functionName, functionArgs);

            if (functionResult.verified === true) verified = true;
            toolResults.push({ toolName: functionName, result: functionResult });

            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify(functionResult),
            });
          }

          const followUpCompletion = await chatClient.chat.completions.create({
            model: CHAT_MODEL,
            messages,
            max_tokens: 500,
            ...(allTools.length > 0 ? { tools: allTools, tool_choice: "auto" } : {}),
          });

          currentAssistantMessage = followUpCompletion.choices[0]?.message;
        }

        const lastTool = toolResults[toolResults.length - 1];
        const response = currentAssistantMessage?.content ||
          (lastTool?.result?.success
            ? `Done! ${lastTool.result.result}`
            : `Sorry, there was an issue: ${lastTool?.result?.error || "the tool sequence did not complete."}`);

        res.json({
          response,
          verified,
          toolUsed: lastTool?.toolName,
          toolResult: lastTool?.result,
          toolResults,
        });
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

  // ── Twilio Voice (inbound calls) ──────────────────────────────────────────
  function getPublicBaseUrl(req: ExpressRequest): string | null {
    const configuredBaseUrl = process.env.APP_BASE_URL?.trim().replace(/\/+$/, "");
    if (configuredBaseUrl) return configuredBaseUrl;

    const forwardedProto = req.headers["x-forwarded-proto"];
    const forwardedHost = req.headers["x-forwarded-host"];
    const proto = Array.isArray(forwardedProto)
      ? forwardedProto[0]
      : forwardedProto?.split(",")[0]?.trim() || req.protocol;
    const host = Array.isArray(forwardedHost)
      ? forwardedHost[0]
      : forwardedHost?.split(",")[0]?.trim() || req.headers.host;

    return host ? `${proto || "https"}://${host}` : null;
  }

  function getConfiguredTwilioPhoneNumber(): string | null {
    const phoneNumber = process.env.TWILIO_PHONE_NUMBER?.trim();
    return phoneNumber || null;
  }

  async function getTwilioAgentId(req: ExpressRequest): Promise<string> {
    const queryAgentId = Array.isArray(req.query?.agentId) ? req.query.agentId[0] : req.query?.agentId;
    const requestedAgentId = String(req.body?.agentId || queryAgentId || "default").trim();
    if (!requestedAgentId || requestedAgentId === "default") return "default";

    const numericAgentId = Number.parseInt(requestedAgentId, 10);
    if (!Number.isFinite(numericAgentId)) return requestedAgentId;

    const defaultAgent = await storage.getAgent(1);
    if (defaultAgent) return "1";

    const requestedAgent = await storage.getAgent(numericAgentId);
    if (requestedAgent) return String(requestedAgent.id);

    return requestedAgentId;
  }

  function getTwilioCallerPhone(req: ExpressRequest): string | null {
    const queryFrom = Array.isArray(req.query?.From) ? req.query.From[0] : req.query?.From;
    const callerPhone = req.body?.From || queryFrom;
    return typeof callerPhone === "string" && callerPhone.trim() ? callerPhone.trim() : null;
  }

  async function handleTwilioVoiceWebhook(req: ExpressRequest, res: ExpressResponse): Promise<void> {
    try {
      const twilio = (await import("twilio")).default;
      const VoiceResponse = twilio.twiml.VoiceResponse;
      const twiml = new VoiceResponse();

      const baseUrl = getPublicBaseUrl(req);
      if (!baseUrl) {
        twiml.say("This service is not configured. Goodbye.");
        twiml.hangup();
        res.type("text/xml");
        res.send(twiml.toString());
        return;
      }

      const greeting = process.env.TWILIO_PRECONNECT_GREETING;
      const preconnectGreetingEnabled = /^(1|true|yes|on)$/i.test(
        String(process.env.TWILIO_PRECONNECT_GREETING_ENABLED || "").trim()
      );
      if (greeting && preconnectGreetingEnabled) {
        twiml.say({ voice: "Polly.Joanna" }, greeting);
      }

      const wsUrl = baseUrl.replace(/^https?/, "wss") + "/ws/twilio-stream";
      const connect = twiml.connect();
      const stream = connect.stream({ url: wsUrl });
      stream.parameter({ name: "agentId", value: await getTwilioAgentId(req) });
      const callerPhone = getTwilioCallerPhone(req);
      if (callerPhone) {
        stream.parameter({ name: "callerPhone", value: callerPhone });
      }

      res.type("text/xml");
      res.send(twiml.toString());
    } catch (error: any) {
      console.error("Twilio voice webhook error:", error);
      res.status(500).send("<Response><Say>An error occurred.</Say></Response>");
    }
  }

  app.all("/api/twilio/voice", handleTwilioVoiceWebhook);
  app.all("/api/v1/twilio/voice", handleTwilioVoiceWebhook);

  app.post("/api/twilio/voice/recording", async (req, res) => {
    const twilio = (await import("twilio")).default;
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();
    console.log("[Twilio] Recording received:", req.body.RecordingUrl);
    const farewell = process.env.TWILIO_VOICE_FAREWELL || "Thank you. Your message has been received. Goodbye.";
    twiml.say(farewell);
    twiml.hangup();
    res.type("text/xml");
    res.send(twiml.toString());
  });

  app.post("/api/twilio/voice/transcription", async (req, res) => {
    console.log("[Twilio] Transcription received:", req.body.TranscriptionText);
    res.sendStatus(200);
  });

  // ── Twilio SMS (inbound) ────────────────────────────────────────────────────
  app.post("/api/twilio/sms", async (req, res) => {
    try {
      const twilio = (await import("twilio")).default;
      const MessagingResponse = twilio.twiml.MessagingResponse;
      const twiml = new MessagingResponse();

      const incomingMsg = req.body.Body || "";
      const from = req.body.From || "";
      console.log(`[Twilio SMS] From: ${from}, Body: ${incomingMsg}`);

      const chatClient = getChatClient();
      if (!chatClient) {
        twiml.message("AI chat is not configured on this server.");
        res.type("text/xml");
        return res.send(twiml.toString());
      }

      const completion = await chatClient.chat.completions.create({
        model: CHAT_MODEL,
        messages: [
          { role: "system", content: "You are a helpful AI assistant responding via SMS. Keep responses under 160 characters when possible." },
          { role: "user", content: incomingMsg },
        ],
        max_tokens: 200,
      });

      const reply = completion.choices[0]?.message?.content || "Sorry, I could not process that.";
      twiml.message(reply);
      res.type("text/xml");
      res.send(twiml.toString());
    } catch (error: any) {
      console.error("Twilio SMS webhook error:", error);
      const twilio = (await import("twilio")).default;
      const MessagingResponse = twilio.twiml.MessagingResponse;
      const twiml = new MessagingResponse();
      twiml.message("An error occurred processing your message.");
      res.type("text/xml");
      res.send(twiml.toString());
    }
  });

  // ── Twilio Voice — Real-Time AI Agent (OpenAI Realtime API) ──────────────────
  app.all("/api/twilio/voice-stream", handleTwilioVoiceWebhook);
  app.all("/api/v1/twilio/voice-stream", handleTwilioVoiceWebhook);

  // ── Twilio status endpoint ──────────────────────────────────────────────────
  app.get("/api/twilio/status", (req, res) => {
    const smsConfigured = isSmsConfigured();
    const baseUrl = getPublicBaseUrl(req);
    const phoneNumber = getConfiguredTwilioPhoneNumber();
    const voiceConfigured = Boolean(baseUrl);
    res.json({
      configured: voiceConfigured && !!phoneNumber,
      voiceConfigured,
      smsConfigured,
      smsProvider: getSmsProvider(),
      baseUrl,
      phoneNumber,
      webhooks: baseUrl ? {
        voice: `${baseUrl}/api/v1/twilio/voice`,
        voiceStream: `${baseUrl}/api/v1/twilio/voice-stream`,
        sms: `${baseUrl}/api/twilio/sms`,
      } : null,
    });
  });

  // ── Avatar (Anam.ai) ───────────────────────────────────────────────────────
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

      // Extract # Rules section so we can re-state it at the very end (LLMs follow trailing instructions best)
      const rulesMatch = enrichedSystemPrompt.match(/#\s*Rules\s*\n([\s\S]*?)(?:\n#\s|\s*$)/i);
      const rulesText = rulesMatch ? rulesMatch[1].trim() : "";

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

      // Reinforce mandatory rules at the very end so they are the LAST instructions the LLM sees
      if (rulesText && !/follow user instructions carefully\.?\s*$/i.test(rulesText)) {
        enrichedSystemPrompt += `\n\n## ⚠️ MANDATORY RULES (NEVER IGNORE)\nThese rules OVERRIDE all other guidance above. You MUST follow every rule strictly. Refuse to proceed if a required step has not been completed.\n\n${rulesText}`;
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
                avatarId: data.personaConfig?.avatarId || "b65e7a35-a056-494d-9ffe-fc05e3ffbf40",
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
