import type { Agent, InsertAgent, Evaluation, InsertEvaluation, WebexRoom, WebexMessage, KnowledgeBaseItem } from "@shared/schema";

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

  delete: async (id: number): Promise<void> => {
    const res = await fetch(`${API_BASE}/agents/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(await res.text());
  },

  update: async (id: number, data: Partial<InsertAgent>): Promise<Agent> => {
    const res = await fetch(`${API_BASE}/agents/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
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
  voice: string;
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
  hasDefaultSpace?: boolean;
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
  verified?: boolean;
  toolUsed?: string;
  toolResult?: {
    success?: boolean;
    result?: string;
    error?: string;
    data?: unknown;
  };
  toolResults?: Array<{
    toolName: string;
    result: {
      success?: boolean;
      result?: string;
      error?: string;
      data?: unknown;
    };
  }>;
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

export interface TranscribeResponse {
  text: string;
}

export const transcribeApi = {
  transcribe: async (audioBlob: Blob): Promise<TranscribeResponse> => {
    const formData = new FormData();
    const extension = audioBlob.type === 'audio/wav' ? 'wav' : 'webm';
    formData.append('audio', audioBlob, `recording.${extension}`);
    
    const res = await fetch(`${API_BASE}/transcribe`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to transcribe audio");
    }
    return res.json();
  },
};

export interface SendMessageRequest {
  roomId?: string;
  text?: string;
  markdown?: string;
}

export interface SendMessageResult {
  success: boolean;
  message: any;
}

export interface WebexProfile {
  hasBearerToken: boolean;
  webexSpaceId: string;
}

export interface WebexProfileUpdate {
  bearerToken?: string;
  webexSpaceId?: string;
}

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

  sendMessage: async (data: SendMessageRequest): Promise<SendMessageResult> => {
    const res = await fetch(`${API_BASE}/webex/messages`, {
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

  getProfile: async (): Promise<WebexProfile> => {
    const res = await fetch(`${API_BASE}/webex/profile`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  updateProfile: async (data: WebexProfileUpdate): Promise<WebexProfile> => {
    const res = await fetch(`${API_BASE}/webex/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to save Webex profile");
    }
    return res.json();
  },
};

export { type KnowledgeBaseItem };

export const knowledgeBaseApi = {
  getByAgent: async (agentId: number): Promise<KnowledgeBaseItem[]> => {
    const res = await fetch(`${API_BASE}/knowledge-base/agent/${agentId}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  addUrl: async (agentId: number, url: string): Promise<KnowledgeBaseItem> => {
    const res = await fetch(`${API_BASE}/knowledge-base/url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, url }),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to add URL");
    }
    return res.json();
  },

  addFile: async (agentId: number, file: File): Promise<KnowledgeBaseItem> => {
    const formData = new FormData();
    formData.append("agentId", String(agentId));
    formData.append("file", file);
    const res = await fetch(`${API_BASE}/knowledge-base/file`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to upload file");
    }
    return res.json();
  },

  addText: async (agentId: number, title: string, content: string): Promise<KnowledgeBaseItem> => {
    const res = await fetch(`${API_BASE}/knowledge-base/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, title, content }),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to save text");
    }
    return res.json();
  },

  update: async (id: number, title: string, content: string): Promise<KnowledgeBaseItem> => {
    const res = await fetch(`${API_BASE}/knowledge-base/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content }),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to update item");
    }
    return res.json();
  },

  delete: async (id: number): Promise<void> => {
    const res = await fetch(`${API_BASE}/knowledge-base/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(await res.text());
  },
};

export interface AnamSessionResponse {
  sessionToken: string;
}

export interface AnamPersonaConfig {
  name?: string;
  avatarId?: string;
  voiceId?: string;
  systemPrompt?: string;
}

export const anamApi = {
  getSessionToken: async (personaConfig?: AnamPersonaConfig, agentId?: number): Promise<AnamSessionResponse> => {
    const res = await fetch(`${API_BASE}/anam/session-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personaConfig, agentId }),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to get Anam session token");
    }
    return res.json();
  },

  getStatus: async (): Promise<{ configured: boolean }> => {
    const res = await fetch(`${API_BASE}/anam/status`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
};

export interface TwilioStatus {
  configured: boolean;
  voiceConfigured: boolean;
  smsConfigured: boolean;
  baseUrl: string | null;
  phoneNumber: string | null;
  webhooks: {
    voice: string;
    voiceStream: string;
    sms: string;
  } | null;
}

export const twilioApi = {
  getStatus: async (): Promise<TwilioStatus> => {
    const res = await fetch(`${API_BASE}/twilio/status`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
};

export interface DemoRuntimeConfig {
  webexSpaceId: string;
  source: "runtime" | "profile" | "unset";
  updatedAt: number | null;
}

export interface DemoPreflightCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface DemoPreflight {
  ready: boolean;
  config: DemoRuntimeConfig;
  checks: DemoPreflightCheck[];
}

export interface DemoScenarioResult {
  id: string;
  label: string;
  passed: boolean;
  expected: string;
  actual: string;
  durationMs: number;
  toolName?: string;
  error?: string;
}

export interface DemoScenarioRun {
  ranAt: number;
  passed: boolean;
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  results: DemoScenarioResult[];
}

export const demoApi = {
  getConfig: async (): Promise<DemoRuntimeConfig> => {
    const res = await fetch(`${API_BASE}/demo/config`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  updateConfig: async (data: { webexSpaceId?: string }): Promise<DemoRuntimeConfig> => {
    const res = await fetch(`${API_BASE}/demo/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to save demo config");
    }
    const payload = await res.json();
    return payload.config;
  },

  getPreflight: async (): Promise<DemoPreflight> => {
    const res = await fetch(`${API_BASE}/demo/preflight`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  runScenarios: async (): Promise<DemoScenarioRun> => {
    const res = await fetch(`${API_BASE}/demo/scenarios/run`, {
      method: "POST",
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to run demo scenarios");
    }
    return res.json();
  },
};

export const ocrApi = {
  extractText: async (imageDataUrl: string): Promise<{ text: string }> => {
    const res = await fetch(`${API_BASE}/ocr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: imageDataUrl }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "OCR failed");
    }
    return res.json();
  },
};

export interface AgentTool {
  name: string;
  description: string;
  provider?: string;
  implemented?: boolean;
}

export const useCaseToolsApi = {
  getByUseCase: async (useCaseId: string): Promise<AgentTool[]> => {
    const res = await fetch(`${API_BASE}/use-cases/${encodeURIComponent(useCaseId)}/tools`);
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to fetch use case tools");
    }
    return res.json();
  },
};
