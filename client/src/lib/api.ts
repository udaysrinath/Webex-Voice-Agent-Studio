import type { Agent, InsertAgent, Evaluation, InsertEvaluation, WebexRoom, WebexMessage } from "@shared/schema";

const API_BASE = "/api";

export const agentsApi = {
  create: async (data: InsertAgent): Promise<Agent> => {
    const res = await fetch(`${API_BASE}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  getAll: async (): Promise<Agent[]> => {
    const res = await fetch(`${API_BASE}/agents`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  getById: async (id: number): Promise<Agent> => {
    const res = await fetch(`${API_BASE}/agents/${id}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
};

export const evaluationsApi = {
  create: async (data: InsertEvaluation): Promise<Evaluation> => {
    const res = await fetch(`${API_BASE}/evaluations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  getByAgent: async (agentId: number): Promise<Evaluation[]> => {
    const res = await fetch(`${API_BASE}/evaluations/agent/${agentId}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
};

export interface TTSRequest {
  text: string;
  voice: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
  model?: "tts-1" | "tts-1-hd";
}

export interface TTSResponse {
  audio: string;
  contentType: string;
}

export const ttsApi = {
  generate: async (data: TTSRequest): Promise<TTSResponse> => {
    const res = await fetch(`${API_BASE}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to generate speech");
    }
    return res.json();
  },
};

export interface WebexStats {
  roomCount: number;
  messageCount: number;
  hasToken: boolean;
}

export interface WebexSyncResult {
  success: boolean;
  roomsSynced: number;
  messagesSynced: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  message: string;
  systemPrompt?: string;
  agentId?: number;
  history?: ChatMessage[];
}

export interface ChatResponse {
  response: string;
}

export const chatApi = {
  send: async (data: ChatRequest): Promise<ChatResponse> => {
    const res = await fetch(`${API_BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to send message");
    }
    return res.json();
  },
};

export const webexApi = {
  getStats: async (): Promise<WebexStats> => {
    const res = await fetch(`${API_BASE}/webex/stats`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  getRooms: async (): Promise<WebexRoom[]> => {
    const res = await fetch(`${API_BASE}/webex/rooms`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  getMessages: async (limit?: number): Promise<WebexMessage[]> => {
    const url = limit ? `${API_BASE}/webex/messages?limit=${limit}` : `${API_BASE}/webex/messages`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  sync: async (days: number = 30): Promise<WebexSyncResult> => {
    const res = await fetch(`${API_BASE}/webex/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days }),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to sync Webex messages");
    }
    return res.json();
  },
};
