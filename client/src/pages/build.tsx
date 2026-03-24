import { useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, Check, Play, Mic, Cpu, Globe, User, Sparkles, Loader2, Square, MessageSquare, RefreshCw, Send, Code, Copy, ChevronDown, ChevronUp, Wrench, Link2, Plus, Trash2, Search, Mail, Calendar, FileText, Users, CreditCard, Phone, Workflow, Database, Cloud, Shield, Zap, Github, ExternalLink, X, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentsApi, ttsApi, webexApi, knowledgeBaseApi, type TTSRequest, type KnowledgeBaseItem } from "@/lib/api";
import type { InsertAgent } from "@shared/schema";

const LLMS = [
  { id: "gpt-4", name: "GPT-4o", provider: "OpenAI", desc: "Best for reasoning & nuance" },
  { id: "claude-3", name: "Claude 3.5 Sonnet", provider: "Anthropic", desc: "Natural & human-like" },
  { id: "gemini-1.5", name: "Gemini 1.5 Pro", provider: "Google", desc: "Fast & large context" },
];

const VOICES = [
  { id: "alloy", name: "Alloy", gender: "Neutral", style: "Balanced" },
  { id: "echo", name: "Echo", gender: "Male", style: "Deep" },
  { id: "fable", name: "Fable", gender: "Male", style: "British" },
  { id: "onyx", name: "Onyx", gender: "Male", style: "Authoritative" },
  { id: "nova", name: "Nova", gender: "Female", style: "Energetic" },
  { id: "shimmer", name: "Shimmer", gender: "Female", style: "Soft" },
];

const VOICE_PREVIEW_TEXT = "Hello! I'm your voice agent assistant. Let me help you with your tasks.";

const DEFAULT_SYSTEM_PROMPT = `# Personality

You are Webex Agent, a helpful and efficient personal agent.
You are proactive, organized, and focused on providing relevant information to help the user prepare for their day.
You are knowledgeable about the user's team and their ongoing projects.`;

const TURNKEY_TEMPLATES = [
  {
    id: "technical-advisor",
    name: "Technical Advisor",
    icon: "🔧",
    description: "Explains complex technical concepts in simple, easy-to-understand terms",
    color: "from-blue-500/20 to-cyan-500/20",
    borderColor: "border-blue-500/30",
    config: {
      agentName: "Tech Advisor",
      llmModel: "gpt-4",
      voiceModel: "onyx",
      language: "en-US",
      gender: "neutral",
      systemPrompt: `# Personality

You are a Technical Advisor, an expert at explaining complex technical concepts in simple, accessible language.
You break down complicated topics into digestible pieces, use analogies and examples, and ensure the user truly understands.
You are patient, thorough, and never condescending.

# Capabilities
- Explain software architecture, APIs, and system design
- Clarify coding concepts and best practices
- Help debug issues by asking clarifying questions
- Provide technology recommendations based on requirements

# Communication Style
- Use simple language, avoid jargon unless necessary
- Provide examples and analogies from everyday life
- Check for understanding before moving on
- Be encouraging and supportive`,
      tools: [
        { name: "search_documentation", description: "Search technical documentation and knowledge bases" },
        { name: "send_webex_message", description: "Send a message to a Webex space/room" }
      ]
    }
  },
  {
    id: "customer-support",
    name: "Customer Support",
    icon: "💬",
    description: "Friendly and efficient support agent for handling customer inquiries",
    color: "from-green-500/20 to-emerald-500/20",
    borderColor: "border-green-500/30",
    config: {
      agentName: "Support Agent",
      llmModel: "gpt-4",
      voiceModel: "nova",
      language: "en-US",
      gender: "female",
      systemPrompt: `# Personality

You are a Customer Support Agent, friendly, patient, and dedicated to resolving customer issues efficiently.
You listen carefully, show empathy, and always aim to leave customers feeling heard and helped.
You are professional yet warm, and you take ownership of problems.

# Capabilities
- Answer frequently asked questions
- Troubleshoot common issues step by step
- Escalate complex issues to human agents when needed
- Track and follow up on support tickets

# Communication Style
- Greet customers warmly and professionally
- Acknowledge frustrations and show empathy
- Provide clear, step-by-step solutions
- Always confirm the issue is resolved before closing`,
      tools: [
        { name: "search_faq", description: "Search the FAQ and knowledge base for answers" },
        { name: "create_ticket", description: "Create a support ticket for escalation" },
        { name: "send_webex_message", description: "Send a message to a Webex space/room" }
      ]
    }
  },
  {
    id: "servicenow-agent",
    name: "ServiceNow Agent",
    icon: "🎫",
    description: "IT service management assistant for tickets, incidents, and workflows",
    color: "from-orange-500/20 to-amber-500/20",
    borderColor: "border-orange-500/30",
    config: {
      agentName: "ServiceNow Assistant",
      llmModel: "gpt-4",
      voiceModel: "alloy",
      language: "en-US",
      gender: "neutral",
      systemPrompt: `# Personality

You are a ServiceNow Agent, an IT service management specialist who helps users navigate IT workflows efficiently.
You are knowledgeable about ITIL processes, incident management, and service catalogs.
You help users create, track, and resolve IT issues quickly.

# Capabilities
- Create and update incidents, requests, and change tickets
- Check ticket status and provide updates
- Guide users through service catalog requests
- Help with password resets and access requests
- Search the knowledge base for solutions

# Communication Style
- Be efficient and professional
- Use clear ticket references and status updates
- Provide estimated resolution times when possible
- Proactively offer related services or information`,
      tools: [
        { name: "create_incident", description: "Create a new incident ticket in ServiceNow" },
        { name: "get_ticket_status", description: "Check the status of an existing ticket" },
        { name: "search_knowledge_base", description: "Search ServiceNow knowledge articles" },
        { name: "send_webex_message", description: "Send a message to a Webex space/room" }
      ]
    }
  },
  {
    id: "pagerduty-agent",
    name: "PagerDuty Agent",
    icon: "🚨",
    description: "On-call and incident management assistant for DevOps teams",
    color: "from-red-500/20 to-pink-500/20",
    borderColor: "border-red-500/30",
    config: {
      agentName: "PagerDuty Assistant",
      llmModel: "gpt-4",
      voiceModel: "echo",
      language: "en-US",
      gender: "male",
      systemPrompt: `# Personality

You are a PagerDuty Agent, an incident management specialist who helps DevOps teams respond to and resolve incidents.
You are calm under pressure, organized, and focused on minimizing downtime.
You help coordinate on-call schedules and ensure the right people are alerted.

# Capabilities
- Check who is currently on-call for a service
- Trigger, acknowledge, or resolve incidents
- Provide incident summaries and timelines
- Help with on-call schedule management
- Escalate incidents to additional responders

# Communication Style
- Be concise and action-oriented during incidents
- Provide clear status updates with timestamps
- Prioritize critical information first
- Remain calm and organized even in high-pressure situations`,
      tools: [
        { name: "get_oncall", description: "Get the current on-call engineer for a service" },
        { name: "trigger_incident", description: "Trigger a new incident in PagerDuty" },
        { name: "acknowledge_incident", description: "Acknowledge an active incident" },
        { name: "resolve_incident", description: "Resolve an incident" },
        { name: "send_webex_message", description: "Send a message to a Webex space/room" }
      ]
    }
  },
  {
    id: "personal-os",
    name: "My Personal OS",
    icon: "🧠",
    description: "Your personal AI assistant that executes actions across 500+ apps",
    color: "from-violet-500/20 to-fuchsia-500/20",
    borderColor: "border-violet-500/30",
    config: {
      agentName: "Personal OS",
      llmModel: "gpt-4",
      voiceModel: "nova",
      language: "en-US",
      gender: "female",
      systemPrompt: `# Personality

You are My Personal OS, a versatile AI assistant that helps users accomplish tasks across multiple applications and platforms.
You are proactive, helpful, and always ask for confirmation before executing actions that change something.

# Capabilities

Answer Questions: I provide answers using my training knowledge and web search for the most current information.

Execute Actions Across Apps: I can perform tasks in over 500 connected apps, including:
- Email: Send, search, and draft emails (Gmail, Outlook)
- Messaging: Post and send messages on Slack, Webex
- Calendar: Manage events and availability
- Documents: Create and edit files (Google Docs, Notion)
- Project Management: Manage tasks and workflows (GitHub, Jira)
- Other Apps: Instagram, TikTok, Twitter, Figma, etc.

I always ask for confirmation before executing actions that change something.

Help You Think Through Problems: I can brainstorm, analyze, and help refine decisions.

Process Files: I can summarize, extract information, or answer questions about uploaded files.

Remember Your Preferences: I adapt to your communication style over time.

# Communication Style
- Be conversational and friendly
- Ask clarifying questions when needed
- Always confirm before taking actions
- Provide clear summaries of completed tasks
- Adapt to the user's preferences over time`,
      tools: [
        { name: "send_email", description: "Send an email via Gmail or Outlook" },
        { name: "search_email", description: "Search emails in your inbox" },
        { name: "send_slack_message", description: "Send a message on Slack" },
        { name: "create_calendar_event", description: "Create a calendar event" },
        { name: "create_document", description: "Create a document in Google Docs or Notion" },
        { name: "create_github_issue", description: "Create an issue in GitHub" },
        { name: "web_search", description: "Search the web for current information" },
        { name: "send_webex_message", description: "Send a message to a Webex space/room" }
      ]
    }
  },
  {
    id: "prep-for-day",
    name: "Prep Me for the Day",
    icon: "☀️",
    description: "Summarizes your Webex messages to prep you with updates and action items",
    color: "from-amber-500/20 to-orange-500/20",
    borderColor: "border-amber-500/30",
    config: {
      agentName: "Daily Prep Assistant",
      llmModel: "gpt-4",
      voiceModel: "nova",
      language: "en-US",
      gender: "female",
      systemPrompt: `# Personality

You are a Daily Prep Assistant, helping users start their day informed and organized.
You analyze Webex messages to provide a clear summary of what happened, what's important, and what needs attention.
You are concise, prioritized, and action-oriented.

# Capabilities

- Analyze Webex messages from the last 24 hours
- Summarize conversations by importance and urgency
- Extract action items and deadlines mentioned in messages
- Identify mentions of the user and direct requests
- Highlight decisions made and updates from key stakeholders
- Flag any urgent or time-sensitive items

# How You Prep the User

When asked to prep for the day, you will:
1. **Urgent Items First**: Start with anything time-sensitive or requiring immediate action
2. **Key Updates**: Summarize important decisions, announcements, or changes
3. **Action Items**: List tasks assigned to or mentioned for the user with deadlines
4. **FYI Items**: Brief mentions that are good to know but not urgent
5. **Suggested Priorities**: Recommend what to tackle first based on urgency and importance

# Communication Style
- Be concise and scannable - use bullet points
- Lead with the most important information
- Include context but avoid unnecessary details
- Use clear categories to organize information
- End with a motivating note to start the day`,
      tools: [
        { name: "get_webex_messages", description: "Retrieve recent Webex messages from spaces" },
        { name: "summarize_messages", description: "Analyze and summarize message content" },
        { name: "extract_action_items", description: "Extract tasks and deadlines from messages" },
        { name: "get_user_mentions", description: "Find messages where the user was mentioned" },
        { name: "send_webex_message", description: "Send a message to a Webex space/room" }
      ]
    }
  }
];

const INTEGRATION_CATEGORIES = [
  { id: 'all', name: 'All', icon: Zap },
  { id: 'communication', name: 'Communication', icon: MessageSquare },
  { id: 'crm', name: 'CRM & Sales', icon: Users },
  { id: 'support', name: 'Customer Support', icon: Shield },
  { id: 'productivity', name: 'Productivity', icon: FileText },
  { id: 'payments', name: 'Payments', icon: CreditCard },
  { id: 'telephony', name: 'Telephony', icon: Phone },
  { id: 'automation', name: 'Automation', icon: Workflow },
  { id: 'developer', name: 'Developer', icon: Code },
];

const AVAILABLE_INTEGRATIONS = [
  { id: 'webex', name: 'Webex', category: 'communication', icon: '💬', color: 'bg-blue-500/10', iconColor: 'text-blue-400', description: 'Send messages, join meetings, and access Webex spaces', popular: true },
  { id: 'slack', name: 'Slack', category: 'communication', icon: '💬', color: 'bg-purple-500/10', iconColor: 'text-purple-400', description: 'Post messages and manage Slack channels', popular: true },
  { id: 'teams', name: 'Microsoft Teams', category: 'communication', icon: '👥', color: 'bg-indigo-500/10', iconColor: 'text-indigo-400', description: 'Collaborate and communicate via Teams' },
  { id: 'gmail', name: 'Gmail', category: 'communication', icon: '📧', color: 'bg-red-500/10', iconColor: 'text-red-400', description: 'Send, search, and draft emails', popular: true },
  { id: 'outlook', name: 'Outlook', category: 'communication', icon: '📨', color: 'bg-blue-600/10', iconColor: 'text-blue-500', description: 'Manage emails and calendar via Outlook' },
  
  { id: 'salesforce', name: 'Salesforce', category: 'crm', icon: '☁️', color: 'bg-cyan-500/10', iconColor: 'text-cyan-400', description: 'Access CRM data and automate workflows', popular: true },
  { id: 'hubspot', name: 'HubSpot', category: 'crm', icon: '🧡', color: 'bg-orange-500/10', iconColor: 'text-orange-400', description: 'Manage contacts, deals, and marketing' },
  { id: 'zoho', name: 'Zoho CRM', category: 'crm', icon: '🔶', color: 'bg-yellow-500/10', iconColor: 'text-yellow-400', description: 'Voice-enable customer data for personalized interactions' },
  { id: 'monday', name: 'Monday.com', category: 'crm', icon: '📊', color: 'bg-pink-500/10', iconColor: 'text-pink-400', description: 'Project management with real-time AI agents' },
  
  { id: 'zendesk', name: 'Zendesk', category: 'support', icon: '🎫', color: 'bg-green-500/10', iconColor: 'text-green-400', description: 'Voice-first ticket resolution and support', popular: true },
  { id: 'servicenow', name: 'ServiceNow', category: 'support', icon: '🔧', color: 'bg-emerald-500/10', iconColor: 'text-emerald-400', description: 'Enterprise service automation and ITSM' },
  { id: 'intercom', name: 'Intercom', category: 'support', icon: '💭', color: 'bg-blue-400/10', iconColor: 'text-blue-300', description: 'Build voice-first customer service that scales' },
  { id: 'freshdesk', name: 'Freshdesk', category: 'support', icon: '🎯', color: 'bg-teal-500/10', iconColor: 'text-teal-400', description: 'Multi-channel customer support platform' },
  
  { id: 'gcalendar', name: 'Google Calendar', category: 'productivity', icon: '📅', color: 'bg-blue-500/10', iconColor: 'text-blue-400', description: 'Manage events and availability', popular: true },
  { id: 'notion', name: 'Notion', category: 'productivity', icon: '📝', color: 'bg-stone-500/10', iconColor: 'text-stone-400', description: 'Create and manage documents and wikis' },
  { id: 'gdocs', name: 'Google Docs', category: 'productivity', icon: '📄', color: 'bg-blue-400/10', iconColor: 'text-blue-300', description: 'Create and edit documents' },
  { id: 'airtable', name: 'Airtable', category: 'productivity', icon: '📋', color: 'bg-yellow-400/10', iconColor: 'text-yellow-300', description: 'Voice-driven task management through natural conversations' },
  { id: 'confluence', name: 'Confluence', category: 'productivity', icon: '📚', color: 'bg-blue-500/10', iconColor: 'text-blue-400', description: 'Access and search team documentation' },
  
  { id: 'stripe', name: 'Stripe', category: 'payments', icon: '💳', color: 'bg-purple-500/10', iconColor: 'text-purple-400', description: 'Process payments and manage subscriptions', popular: true },
  { id: 'square', name: 'Square', category: 'payments', icon: '⬜', color: 'bg-stone-600/10', iconColor: 'text-stone-300', description: 'Voice commerce with transaction handling' },
  { id: 'shopify', name: 'Shopify', category: 'payments', icon: '🛒', color: 'bg-green-500/10', iconColor: 'text-green-400', description: 'Voice-powered shopping assistant' },
  
  { id: 'twilio', name: 'Twilio', category: 'telephony', icon: '📞', color: 'bg-red-500/10', iconColor: 'text-red-400', description: 'Automated inbound/outbound calls', popular: true },
  { id: 'whatsapp', name: 'WhatsApp', category: 'telephony', icon: '💚', color: 'bg-green-500/10', iconColor: 'text-green-400', description: 'Voice conversations on messaging platforms' },
  { id: 'sip', name: 'SIP Trunking', category: 'telephony', icon: '📱', color: 'bg-gray-500/10', iconColor: 'text-gray-400', description: 'Enterprise-grade telephony integration' },
  
  { id: 'zapier', name: 'Zapier', category: 'automation', icon: '⚡', color: 'bg-orange-500/10', iconColor: 'text-orange-400', description: 'Connect to 5,000+ apps without code', popular: true },
  { id: 'make', name: 'Make', category: 'automation', icon: '🔄', color: 'bg-violet-500/10', iconColor: 'text-violet-400', description: 'Build real-time AI voice agents across your tech stack' },
  { id: 'n8n', name: 'n8n', category: 'automation', icon: '🔗', color: 'bg-pink-500/10', iconColor: 'text-pink-400', description: 'Orchestrate complex workflows across any system' },
  
  { id: 'github', name: 'GitHub', category: 'developer', icon: '🐙', color: 'bg-gray-500/10', iconColor: 'text-gray-300', description: 'Create issues, PRs, and manage repositories', popular: true },
  { id: 'jira', name: 'Jira', category: 'developer', icon: '🔷', color: 'bg-blue-500/10', iconColor: 'text-blue-400', description: 'Manage tasks and workflows' },
  { id: 'pagerduty', name: 'PagerDuty', category: 'developer', icon: '🚨', color: 'bg-green-600/10', iconColor: 'text-green-500', description: 'Incident management and on-call automation' },
  { id: 'datadog', name: 'Datadog', category: 'developer', icon: '🐕', color: 'bg-purple-500/10', iconColor: 'text-purple-400', description: 'Monitor and analyze application performance' },
  { id: 'supabase', name: 'Supabase', category: 'developer', icon: '⚡', color: 'bg-emerald-500/10', iconColor: 'text-emerald-400', description: 'Transform databases into voice-driven knowledge bases' },
];

export default function Build() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [buildMode, setBuildMode] = useState<'choice' | 'scratch' | 'template'>('choice');
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  
  const [agentName, setAgentName] = useState("Agent Alpha-1");
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [selectedLLM, setSelectedLLM] = useState(LLMS[0].id);
  const [selectedVoice, setSelectedVoice] = useState(VOICES[0].id);
  const [language, setLanguage] = useState("en-US");
  const [gender, setGender] = useState("neutral");
  
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  
  const [selectedRoomId, setSelectedRoomId] = useState<string>("");
  const [messageText, setMessageText] = useState("");
  const [showFunctionCode, setShowFunctionCode] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [activeKbTab, setActiveKbTab] = useState<'sources' | 'tools' | 'integrations'>('sources');
  const [showAddTool, setShowAddTool] = useState(false);
  const [showAddIntegration, setShowAddIntegration] = useState(false);
  const [newToolName, setNewToolName] = useState("");
  const [newToolDescription, setNewToolDescription] = useState("");
  const [newIntegrationName, setNewIntegrationName] = useState("");
  const [integrationSearch, setIntegrationSearch] = useState("");
  const [integrationCategory, setIntegrationCategory] = useState("all");
  const [connectedIntegrations, setConnectedIntegrations] = useState<Set<string>>(new Set());
  const [tools, setTools] = useState<Array<{name: string; description: string}>>([
    { name: "send_webex_message", description: "Send a message to a Webex space/room" }
  ]);
  const [customIntegrations, setCustomIntegrations] = useState<Array<{name: string; status: string}>>([]);
  const [showMcpForm, setShowMcpForm] = useState(false);
  const [mcpServers, setMcpServers] = useState<Array<{name: string; endpoint: string; description: string; status: string}>>([]);
  const [newMcpName, setNewMcpName] = useState("");
  const [newMcpEndpoint, setNewMcpEndpoint] = useState("");
  const [newMcpDescription, setNewMcpDescription] = useState("");

  const [showAddUrl, setShowAddUrl] = useState(false);
  const [showAddText, setShowAddText] = useState(false);
  const [newKbUrl, setNewKbUrl] = useState("");
  const [newKbTitle, setNewKbTitle] = useState("");
  const [newKbContent, setNewKbContent] = useState("");
  const [kbLoading, setKbLoading] = useState(false);
  const [savedAgentId, setSavedAgentId] = useState<number | null>(null);

  const { data: webexStats } = useQuery({
    queryKey: ["webex-stats"],
    queryFn: () => webexApi.getStats(),
  });

  const { data: webexRooms = [] } = useQuery({
    queryKey: ["webex-rooms"],
    queryFn: () => webexApi.getRooms(),
    enabled: !!webexStats?.hasToken,
  });

  const { data: kbItems = [], refetch: refetchKbItems } = useQuery<KnowledgeBaseItem[]>({
    queryKey: ["knowledge-base", savedAgentId],
    queryFn: () => knowledgeBaseApi.getByAgent(savedAgentId!),
    enabled: !!savedAgentId,
  });

  const syncWebexMutation = useMutation({
    mutationFn: (days: number) => webexApi.sync(days),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["webex-stats"] });
      queryClient.invalidateQueries({ queryKey: ["webex-rooms"] });
      toast({
        title: "Webex Sync Complete",
        description: `Synced ${result.messagesSynced} messages from ${result.roomsSynced} rooms.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Sync Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: (data: { roomId: string; text: string }) => webexApi.sendMessage(data),
    onSuccess: () => {
      setMessageText("");
      toast({
        title: "Message Sent",
        description: "Your message was sent to the Webex space.",
      });
    },
    onError: (error) => {
      toast({
        title: "Send Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSendMessage = () => {
    if (!selectedRoomId || !messageText.trim()) return;
    sendMessageMutation.mutate({ roomId: selectedRoomId, text: messageText.trim() });
  };

  const createAgentMutation = useMutation({
    mutationFn: (data: InsertAgent) => agentsApi.create(data),
    onSuccess: (agent) => {
      setSavedAgentId(agent.id);
      setActiveKbTab('sources');
      toast({
        title: "Agent Created Successfully",
        description: "Add knowledge sources below, then start evaluating.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error Creating Agent",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleVoicePreview = async (voiceId: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    
    if (playingVoice === voiceId) {
      setPlayingVoice(null);
      return;
    }
    
    setPreviewingVoice(voiceId);
    setPlayingVoice(null);
    
    try {
      const response = await ttsApi.generate({
        text: VOICE_PREVIEW_TEXT,
        voice: voiceId as TTSRequest["voice"],
        model: "tts-1",
      });
      
      const audioData = `data:${response.contentType};base64,${response.audio}`;
      const audio = new Audio(audioData);
      audioRef.current = audio;
      
      audio.onended = () => {
        setPlayingVoice(null);
      };
      
      audio.onerror = () => {
        setPlayingVoice(null);
        toast({
          title: "Playback Error",
          description: "Unable to play the audio preview.",
          variant: "destructive",
        });
      };
      
      await audio.play();
      setPlayingVoice(voiceId);
    } catch (error: any) {
      toast({
        title: "Preview Error",
        description: error.message || "Failed to generate voice preview.",
        variant: "destructive",
      });
    } finally {
      setPreviewingVoice(null);
    }
  };

  const handleCreate = () => {
    createAgentMutation.mutate({
      name: agentName,
      systemPrompt,
      llmModel: selectedLLM,
      voiceModel: selectedVoice,
      language,
      gender,
    });
  };

  const applyTemplate = (templateId: string) => {
    const template = TURNKEY_TEMPLATES.find(t => t.id === templateId);
    if (template) {
      setAgentName(template.config.agentName);
      setSystemPrompt(template.config.systemPrompt);
      setSelectedLLM(template.config.llmModel);
      setSelectedVoice(template.config.voiceModel);
      setLanguage(template.config.language);
      setGender(template.config.gender);
      setTools(template.config.tools);
      setSelectedTemplate(templateId);
      setBuildMode('template');
      toast({
        title: "Template Applied",
        description: `${template.name} settings loaded. Customize as needed.`,
      });
    }
  };

  const handleCopyCode = async (code: string, id: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const functionCallingCode = {
    toolDefinition: `const webexTools = [
  {
    type: "function",
    function: {
      name: "send_webex_message",
      description: "Send a message to a Webex space/room",
      parameters: {
        type: "object",
        properties: {
          roomTitle: {
            type: "string",
            description: "The title/name of the Webex room"
          },
          message: {
            type: "string", 
            description: "The message content to send"
          }
        },
        required: ["roomTitle", "message"]
      }
    }
  }
];`,
    apiCall: `const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage }
  ],
  tools: webexTools,
  tool_choice: "auto"
});`,
    handleToolCall: `if (response.choices[0].message.tool_calls) {
  for (const toolCall of response.choices[0].message.tool_calls) {
    if (toolCall.function.name === "send_webex_message") {
      const args = JSON.parse(toolCall.function.arguments);
      const result = await sendWebexMessage(
        args.roomTitle, 
        args.message
      );
      // Continue conversation with tool result
    }
  }
}`
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans pb-20">
      <header className="border-b border-white/10 bg-background/50 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/">
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-primary">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back to Home
            </Button>
          </Link>
          <h1 className="text-lg font-display font-bold">Build Agent</h1>
          <div className="w-20" />
        </div>
      </header>

      <main className="container mx-auto px-4 py-10 max-w-4xl">
        <div className="space-y-12">
          
          {/* Template Selection - Show when in choice mode */}
          {buildMode === 'choice' && (
            <motion.section 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              <div className="text-center mb-8">
                <h2 className="text-3xl font-display font-bold mb-3">How would you like to start?</h2>
                <p className="text-muted-foreground">Choose a turnkey template or build from scratch</p>
              </div>

              <div className="grid md:grid-cols-2 gap-6 mb-8">
                {TURNKEY_TEMPLATES.map((template) => (
                  <motion.div
                    key={template.id}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <Card 
                      className={`p-6 cursor-pointer bg-gradient-to-br ${template.color} border ${template.borderColor} hover:border-white/30 transition-all`}
                      onClick={() => applyTemplate(template.id)}
                      data-testid={`template-card-${template.id}`}
                    >
                      <div className="flex items-start gap-4">
                        <div className="text-4xl">{template.icon}</div>
                        <div className="flex-1">
                          <h3 className="text-lg font-semibold mb-1">{template.name}</h3>
                          <p className="text-sm text-muted-foreground mb-3">{template.description}</p>
                          <div className="flex flex-wrap gap-1">
                            {template.config.tools.slice(0, 2).map((tool, i) => (
                              <span key={i} className="text-xs px-2 py-1 rounded-full bg-white/10 text-white/70">
                                {tool.name.replace(/_/g, ' ')}
                              </span>
                            ))}
                            {template.config.tools.length > 2 && (
                              <span className="text-xs px-2 py-1 rounded-full bg-white/10 text-white/70">
                                +{template.config.tools.length - 2} more
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </Card>
                  </motion.div>
                ))}
              </div>

              <div className="text-center">
                <div className="flex items-center gap-4 justify-center mb-4">
                  <div className="h-px w-16 bg-white/20" />
                  <span className="text-muted-foreground text-sm">or</span>
                  <div className="h-px w-16 bg-white/20" />
                </div>
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => setBuildMode('scratch')}
                  className="px-8"
                  data-testid="button-build-from-scratch"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Build from Scratch
                </Button>
              </div>
            </motion.section>
          )}

          {/* Show agent builder when not in choice mode */}
          {buildMode !== 'choice' && (
            <>
              {/* Back to templates button */}
              <div className="flex items-center gap-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setBuildMode('choice')}
                  className="text-muted-foreground"
                  data-testid="button-back-to-templates"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Templates
                </Button>
                {selectedTemplate && (
                  <span className="text-sm text-muted-foreground">
                    Based on: <span className="text-primary font-medium">
                      {TURNKEY_TEMPLATES.find(t => t.id === selectedTemplate)?.name}
                    </span>
                  </span>
                )}
              </div>

          <motion.section 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-400">
                <User className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-2xl font-display font-semibold">Agent Identity</h2>
                <p className="text-muted-foreground text-sm">Give your agent a unique name.</p>
              </div>
            </div>
            
            <div className="space-y-6">
              <div className="space-y-3">
                <Label className="text-base">Agent Name</Label>
                <Input 
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder="e.g., Tech Talk Host"
                  className="h-12 bg-background border-white/10"
                  data-testid="input-agent-name"
                />
              </div>
              
              <div className="space-y-3">
                <Label className="text-base">System Prompt</Label>
                <Textarea 
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="Define your agent's personality and behavior..."
                  className="min-h-[150px] bg-background border-white/10 resize-y"
                  data-testid="input-system-prompt"
                />
                <p className="text-xs text-muted-foreground">
                  This prompt defines your agent's personality and how it should respond.
                </p>
              </div>
            </div>
          </motion.section>

          <motion.section 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <Cpu className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-2xl font-display font-semibold">Intelligence Engine</h2>
                <p className="text-muted-foreground text-sm">Select the LLM that powers your agent's thoughts.</p>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-4">
              {LLMS.map((llm) => (
                <div 
                  key={llm.id}
                  onClick={() => setSelectedLLM(llm.id)}
                  className={`cursor-pointer relative rounded-xl border p-5 transition-all duration-200 ${
                    selectedLLM === llm.id 
                      ? "bg-primary/10 border-primary ring-1 ring-primary" 
                      : "bg-card border-border hover:border-primary/50"
                  }`}
                  data-testid={`llm-card-${llm.id}`}
                >
                  {selectedLLM === llm.id && (
                    <div className="absolute top-3 right-3 text-primary">
                      <Check className="w-4 h-4" />
                    </div>
                  )}
                  <div className="font-semibold mb-1">{llm.name}</div>
                  <div className="text-xs text-primary/80 mb-3 uppercase tracking-wider font-medium">{llm.provider}</div>
                  <div className="text-sm text-muted-foreground">{llm.desc}</div>
                </div>
              ))}
            </div>
          </motion.section>

          <motion.section 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-400">
                <Mic className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-2xl font-display font-semibold">Persona & Voice</h2>
                <p className="text-muted-foreground text-sm">Define how your agent sounds and speaks.</p>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-8 bg-card/30 p-6 rounded-2xl border border-white/5">
              
              <div className="space-y-6">
                <div className="space-y-3">
                  <Label className="text-base">Language</Label>
                  <Select value={language} onValueChange={setLanguage}>
                    <SelectTrigger className="w-full h-12 bg-background border-white/10 focus:ring-primary" data-testid="select-language">
                      <SelectValue placeholder="Select Language" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en-US">English (US)</SelectItem>
                      <SelectItem value="en-GB">English (UK)</SelectItem>
                      <SelectItem value="es-ES">Spanish</SelectItem>
                      <SelectItem value="fr-FR">French</SelectItem>
                      <SelectItem value="de-DE">German</SelectItem>
                      <SelectItem value="ja-JP">Japanese</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-3">
                  <Label className="text-base">Gender Preference</Label>
                  <RadioGroup value={gender} onValueChange={setGender} className="flex gap-4">
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="male" id="r1" className="border-white/20 text-primary" />
                      <Label htmlFor="r1" className="cursor-pointer">Male</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="female" id="r2" className="border-white/20 text-primary" />
                      <Label htmlFor="r2" className="cursor-pointer">Female</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="neutral" id="r3" className="border-white/20 text-primary" />
                      <Label htmlFor="r3" className="cursor-pointer">Neutral</Label>
                    </div>
                  </RadioGroup>
                </div>
              </div>

              <div className="space-y-3">
                 <Label className="text-base flex justify-between">
                    <span>Voice Model</span>
                    <span className="text-xs text-muted-foreground font-normal">Click icon to preview</span>
                 </Label>
                 <div className="grid grid-cols-2 gap-3">
                    {VOICES.map(voice => (
                      <div 
                        key={voice.id}
                        onClick={() => setSelectedVoice(voice.id)}
                        className={`p-3 rounded-lg border cursor-pointer flex items-center justify-between group transition-all ${
                          selectedVoice === voice.id 
                            ? "bg-primary/10 border-primary" 
                            : "bg-background border-white/10 hover:border-white/30"
                        }`}
                        data-testid={`voice-card-${voice.id}`}
                      >
                        <div className="flex flex-col">
                          <span className="font-medium text-sm">{voice.name}</span>
                          <span className="text-xs text-muted-foreground">{voice.style}</span>
                        </div>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className={`h-8 w-8 rounded-full ${selectedVoice === voice.id ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground group-hover:text-foreground"}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleVoicePreview(voice.id);
                          }}
                          disabled={previewingVoice !== null}
                        >
                          {previewingVoice === voice.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : playingVoice === voice.id ? (
                            <Square className="w-3 h-3 fill-current" />
                          ) : (
                            <Play className="w-3 h-3 fill-current" />
                          )}
                        </Button>
                      </div>
                    ))}
                 </div>
              </div>

            </div>
          </motion.section>

          <motion.section 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center text-green-400">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-2xl font-display font-semibold">Knowledge Base</h2>
                <p className="text-muted-foreground text-sm">Configure tools and integrations for your agent.</p>
              </div>
            </div>

            <div className="bg-card/30 rounded-2xl border border-white/5">
              <div className="flex border-b border-white/5">
                <button
                  onClick={() => setActiveKbTab('sources')}
                  className={`flex-1 px-4 py-4 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                    activeKbTab === 'sources'
                      ? 'text-primary border-b-2 border-primary bg-primary/5'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  data-testid="tab-sources"
                >
                  <FileText className="w-4 h-4" />
                  Sources
                </button>
                <button
                  onClick={() => setActiveKbTab('tools')}
                  className={`flex-1 px-4 py-4 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                    activeKbTab === 'tools' 
                      ? 'text-primary border-b-2 border-primary bg-primary/5' 
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  data-testid="tab-tools"
                >
                  <Wrench className="w-4 h-4" />
                  Tools
                </button>
                <button
                  onClick={() => setActiveKbTab('integrations')}
                  className={`flex-1 px-4 py-4 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                    activeKbTab === 'integrations' 
                      ? 'text-primary border-b-2 border-primary bg-primary/5' 
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  data-testid="tab-integrations"
                >
                  <Link2 className="w-4 h-4" />
                  Integrations
                </button>
              </div>

              <div className="p-6">
                {activeKbTab === 'sources' && (
                  <div className="space-y-4">
                    {!savedAgentId ? (
                      <div className="text-center py-8 px-4">
                        <FileText className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-50" />
                        <p className="font-medium mb-1">Save your agent first</p>
                        <p className="text-sm text-muted-foreground">Create your agent below to start adding knowledge sources.</p>
                      </div>
                    ) : (
                      <>
                        <div>
                          <p className="font-medium mb-1">Knowledge Sources</p>
                          <p className="text-sm text-muted-foreground mb-4">Add URLs, files, or text that your agent will use when answering questions.</p>
                          <div className="flex gap-2 flex-wrap">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => { setShowAddUrl(true); setShowAddText(false); }}
                              className="gap-2 border-white/10"
                              data-testid="button-add-url"
                            >
                              <Link2 className="w-4 h-4" />
                              Add URL
                            </Button>
                            <label className="cursor-pointer inline-flex items-center gap-2 text-sm font-medium h-8 px-3 rounded-md border border-white/10 bg-transparent hover:bg-white/5 transition-colors">
                              <input
                                type="file"
                                accept=".txt,.md,.pdf,.csv"
                                className="hidden"
                                data-testid="input-add-file"
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (!file || !savedAgentId) return;
                                  setKbLoading(true);
                                  try {
                                    await knowledgeBaseApi.addFile(savedAgentId, file);
                                    refetchKbItems();
                                    toast({ title: "File added", description: `"${file.name}" was added to your knowledge base.` });
                                  } catch (err: any) {
                                    toast({ title: "Upload failed", description: err.message, variant: "destructive" });
                                  } finally {
                                    setKbLoading(false);
                                    e.target.value = "";
                                  }
                                }}
                              />
                              {kbLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                              Add File
                            </label>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => { setShowAddText(true); setShowAddUrl(false); }}
                              className="gap-2 border-white/10"
                              data-testid="button-create-text"
                            >
                              <FileText className="w-4 h-4" />
                              Create Text
                            </Button>
                          </div>
                        </div>

                        {showAddUrl && (
                          <div className="p-4 bg-background/50 rounded-lg border border-white/10 space-y-3">
                            <p className="text-sm font-medium">Add URL</p>
                            <Input
                              value={newKbUrl}
                              onChange={(e) => setNewKbUrl(e.target.value)}
                              placeholder="https://example.com/page"
                              className="bg-background border-white/10"
                              data-testid="input-kb-url"
                            />
                            <div className="flex justify-end gap-2">
                              <Button variant="ghost" size="sm" onClick={() => { setShowAddUrl(false); setNewKbUrl(""); }}>Cancel</Button>
                              <Button
                                size="sm"
                                disabled={!newKbUrl || kbLoading}
                                data-testid="button-save-url"
                                onClick={async () => {
                                  if (!savedAgentId || !newKbUrl) return;
                                  setKbLoading(true);
                                  try {
                                    await knowledgeBaseApi.addUrl(savedAgentId, newKbUrl);
                                    refetchKbItems();
                                    setShowAddUrl(false);
                                    setNewKbUrl("");
                                    toast({ title: "URL added", description: "Page content was fetched and saved." });
                                  } catch (err: any) {
                                    toast({ title: "Failed to add URL", description: err.message, variant: "destructive" });
                                  } finally {
                                    setKbLoading(false);
                                  }
                                }}
                              >
                                {kbLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Fetch & Save"}
                              </Button>
                            </div>
                          </div>
                        )}

                        {showAddText && (
                          <div className="p-4 bg-background/50 rounded-lg border border-white/10 space-y-3">
                            <p className="text-sm font-medium">Create Text</p>
                            <Input
                              value={newKbTitle}
                              onChange={(e) => setNewKbTitle(e.target.value)}
                              placeholder="Title"
                              className="bg-background border-white/10"
                              data-testid="input-kb-text-title"
                            />
                            <Textarea
                              value={newKbContent}
                              onChange={(e) => setNewKbContent(e.target.value)}
                              placeholder="Paste or write your content here..."
                              className="bg-background border-white/10 min-h-[120px]"
                              data-testid="input-kb-text-content"
                            />
                            <div className="flex justify-end gap-2">
                              <Button variant="ghost" size="sm" onClick={() => { setShowAddText(false); setNewKbTitle(""); setNewKbContent(""); }}>Cancel</Button>
                              <Button
                                size="sm"
                                disabled={!newKbTitle || !newKbContent || kbLoading}
                                data-testid="button-save-text"
                                onClick={async () => {
                                  if (!savedAgentId || !newKbTitle || !newKbContent) return;
                                  setKbLoading(true);
                                  try {
                                    await knowledgeBaseApi.addText(savedAgentId, newKbTitle, newKbContent);
                                    refetchKbItems();
                                    setShowAddText(false);
                                    setNewKbTitle("");
                                    setNewKbContent("");
                                    toast({ title: "Text saved", description: "Your text was added to the knowledge base." });
                                  } catch (err: any) {
                                    toast({ title: "Failed to save text", description: err.message, variant: "destructive" });
                                  } finally {
                                    setKbLoading(false);
                                  }
                                }}
                              >
                                {kbLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
                              </Button>
                            </div>
                          </div>
                        )}

                        <div className="space-y-2">
                          {kbItems.map((item) => (
                            <div
                              key={item.id}
                              className="flex items-center justify-between p-3 bg-background/30 rounded-lg border border-white/5"
                              data-testid={`kb-item-${item.id}`}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                                  item.type === 'url' ? 'bg-blue-500/10' : item.type === 'file' ? 'bg-purple-500/10' : 'bg-green-500/10'
                                }`}>
                                  {item.type === 'url' && <Link2 className="w-4 h-4 text-blue-400" />}
                                  {item.type === 'file' && <Database className="w-4 h-4 text-purple-400" />}
                                  {item.type === 'text' && <FileText className="w-4 h-4 text-green-400" />}
                                </div>
                                <div className="min-w-0">
                                  <p className="font-medium text-sm truncate">{item.title}</p>
                                  <p className="text-xs text-muted-foreground">{item.type === 'url' ? 'URL' : item.type === 'file' ? 'File' : 'Text'} · {item.content.length.toLocaleString()} chars</p>
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-red-400 shrink-0"
                                data-testid={`button-delete-kb-${item.id}`}
                                onClick={async () => {
                                  try {
                                    await knowledgeBaseApi.delete(item.id);
                                    refetchKbItems();
                                    toast({ title: "Source removed" });
                                  } catch (err: any) {
                                    toast({ title: "Failed to remove", description: err.message, variant: "destructive" });
                                  }
                                }}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          ))}
                          {kbItems.length === 0 && !showAddUrl && !showAddText && (
                            <div className="text-center py-6 text-muted-foreground">
                              <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                              <p className="text-sm">No sources added yet</p>
                            </div>
                          )}
                        </div>

                        <div className="pt-2">
                          <Button
                            className="w-full"
                            onClick={() => setLocation(`/evaluate?agentId=${savedAgentId}`)}
                            data-testid="button-start-evaluating"
                          >
                            Start Evaluating
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {activeKbTab === 'tools' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">Agent Tools</p>
                        <p className="text-sm text-muted-foreground">
                          Functions your agent can call to perform actions.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowAddTool(!showAddTool)}
                        data-testid="button-add-tool"
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        Add Tool
                      </Button>
                    </div>

                    {showAddTool && (
                      <div className="p-4 bg-background/50 rounded-lg border border-white/10 space-y-3">
                        <div className="space-y-2">
                          <Label className="text-sm">Tool Name</Label>
                          <Input
                            value={newToolName}
                            onChange={(e) => setNewToolName(e.target.value)}
                            placeholder="e.g., get_weather"
                            className="bg-background border-white/10"
                            data-testid="input-tool-name"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">Description</Label>
                          <Textarea
                            value={newToolDescription}
                            onChange={(e) => setNewToolDescription(e.target.value)}
                            placeholder="What does this tool do?"
                            className="bg-background border-white/10 min-h-[60px]"
                            data-testid="input-tool-description"
                          />
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setShowAddTool(false);
                              setNewToolName("");
                              setNewToolDescription("");
                            }}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => {
                              if (newToolName && newToolDescription) {
                                setTools([...tools, { name: newToolName, description: newToolDescription }]);
                                setNewToolName("");
                                setNewToolDescription("");
                                setShowAddTool(false);
                              }
                            }}
                            disabled={!newToolName || !newToolDescription}
                            data-testid="button-save-tool"
                          >
                            Save Tool
                          </Button>
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      {tools.map((tool, index) => (
                        <div 
                          key={index}
                          className="flex items-center justify-between p-3 bg-background/30 rounded-lg border border-white/5"
                          data-testid={`tool-item-${index}`}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center">
                              <Wrench className="w-4 h-4 text-green-400" />
                            </div>
                            <div>
                              <p className="font-medium text-sm">{tool.name}</p>
                              <p className="text-xs text-muted-foreground">{tool.description}</p>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-red-400"
                            onClick={() => setTools(tools.filter((_, i) => i !== index))}
                            data-testid={`button-delete-tool-${index}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                      {tools.length === 0 && (
                        <div className="text-center py-6 text-muted-foreground">
                          <Wrench className="w-8 h-8 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">No tools configured yet</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeKbTab === 'integrations' && (
                  <div className="space-y-6">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        value={integrationSearch}
                        onChange={(e) => setIntegrationSearch(e.target.value)}
                        placeholder="Search integrations..."
                        className="pl-10 bg-background border-white/10"
                        data-testid="input-integration-search"
                      />
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {INTEGRATION_CATEGORIES.map((cat) => {
                        const Icon = cat.icon;
                        return (
                          <Button
                            key={cat.id}
                            variant={integrationCategory === cat.id ? "default" : "outline"}
                            size="sm"
                            onClick={() => setIntegrationCategory(cat.id)}
                            className={`gap-2 ${integrationCategory === cat.id ? '' : 'border-white/10 hover:bg-white/5'}`}
                            data-testid={`filter-category-${cat.id}`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                            {cat.name}
                          </Button>
                        );
                      })}
                    </div>

                    {(webexStats?.hasToken || connectedIntegrations.size > 0 || customIntegrations.length > 0) && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-medium text-muted-foreground">
                            Connected ({(webexStats?.hasToken ? 1 : 0) + connectedIntegrations.size + customIntegrations.length})
                          </h3>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {webexStats?.hasToken && (() => {
                            const webexIntegration = AVAILABLE_INTEGRATIONS.find(i => i.id === 'webex')!;
                            return (
                              <motion.div
                                key="webex"
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="p-4 rounded-xl border border-green-500/30 bg-gradient-to-br from-green-500/5 to-emerald-500/5 hover:from-green-500/10 hover:to-emerald-500/10 transition-all"
                                data-testid="integration-connected-webex"
                              >
                                <div className="flex items-start justify-between">
                                  <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 rounded-lg ${webexIntegration.color} flex items-center justify-center text-xl`}>
                                      {webexIntegration.icon}
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <p className="font-medium">{webexIntegration.name}</p>
                                        <span className="text-xs text-green-400 flex items-center gap-1">
                                          <Check className="w-3 h-3" />
                                          Connected
                                        </span>
                                      </div>
                                      <p className="text-xs text-muted-foreground mt-0.5">{webexStats.messageCount} messages from {webexStats.roomCount} rooms</p>
                                    </div>
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => syncWebexMutation.mutate(15)}
                                    disabled={syncWebexMutation.isPending}
                                    data-testid="button-sync-webex"
                                  >
                                    {syncWebexMutation.isPending ? (
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                      <RefreshCw className="w-4 h-4" />
                                    )}
                                  </Button>
                                </div>
                              </motion.div>
                            );
                          })()}
                          
                          {AVAILABLE_INTEGRATIONS.filter(i => i.id !== 'webex' && connectedIntegrations.has(i.id)).map((integration) => (
                            <motion.div
                              key={integration.id}
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="p-4 rounded-xl border border-green-500/30 bg-gradient-to-br from-green-500/5 to-emerald-500/5 hover:from-green-500/10 hover:to-emerald-500/10 transition-all"
                              data-testid={`integration-connected-${integration.id}`}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex items-center gap-3">
                                  <div className={`w-10 h-10 rounded-lg ${integration.color} flex items-center justify-center text-xl`}>
                                    {integration.icon}
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <p className="font-medium">{integration.name}</p>
                                      <span className="text-xs text-green-400 flex items-center gap-1">
                                        <Check className="w-3 h-3" />
                                        Connected
                                      </span>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-0.5">{integration.description}</p>
                                  </div>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-red-400"
                                  onClick={() => {
                                    const newSet = new Set(connectedIntegrations);
                                    newSet.delete(integration.id);
                                    setConnectedIntegrations(newSet);
                                    toast({
                                      title: "Integration Disconnected",
                                      description: `${integration.name} has been disconnected.`,
                                    });
                                  }}
                                  data-testid={`button-disconnect-${integration.id}`}
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                              </div>
                            </motion.div>
                          ))}
                          
                          {customIntegrations.map((integration, index) => (
                            <motion.div
                              key={`custom-${index}`}
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="p-4 rounded-xl border border-yellow-500/30 bg-gradient-to-br from-yellow-500/5 to-orange-500/5"
                              data-testid={`integration-custom-${index}`}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                                    <Link2 className="w-5 h-5 text-purple-400" />
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <p className="font-medium">{integration.name}</p>
                                      <span className="text-xs text-yellow-400">Pending setup</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-0.5">Configure credentials to complete setup</p>
                                  </div>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-red-400"
                                  onClick={() => setCustomIntegrations(customIntegrations.filter((_, i) => i !== index))}
                                  data-testid={`button-delete-integration-${index}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      </div>
                    )}

                    {webexStats?.hasToken && webexRooms.length > 0 && (
                      <div className="p-4 bg-background/30 rounded-lg border border-white/5 space-y-3">
                        <Label className="text-sm font-medium">Quick Send to Webex</Label>
                        <Select value={selectedRoomId} onValueChange={setSelectedRoomId}>
                          <SelectTrigger className="w-full bg-background border-white/10" data-testid="select-webex-room">
                            <SelectValue placeholder="Select a space..." />
                          </SelectTrigger>
                          <SelectContent className="max-h-60 overflow-y-auto">
                            {webexRooms.map((room) => (
                              <SelectItem key={room.id} value={room.id} className="truncate">
                                {room.title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        
                        {selectedRoomId && (
                          <div className="space-y-2">
                            <Textarea
                              value={messageText}
                              onChange={(e) => setMessageText(e.target.value)}
                              placeholder="Type your message..."
                              className="min-h-[60px] bg-background border-white/10 resize-none"
                              data-testid="input-webex-message"
                            />
                            <div className="flex justify-end">
                              <Button
                                size="sm"
                                onClick={handleSendMessage}
                                disabled={sendMessageMutation.isPending || !messageText.trim()}
                                data-testid="button-send-webex-message"
                              >
                                {sendMessageMutation.isPending ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <>
                                    <Send className="w-4 h-4 mr-2" />
                                    Send
                                  </>
                                )}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {mcpServers.length > 0 && (
                      <div className="space-y-3">
                        <h3 className="text-sm font-medium text-muted-foreground">MCP Servers ({mcpServers.length})</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {mcpServers.map((server, index) => (
                            <motion.div
                              key={`mcp-${index}`}
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="p-4 rounded-xl border border-cyan-500/30 bg-gradient-to-br from-cyan-500/5 to-blue-500/5"
                              data-testid={`mcp-server-${index}`}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                                    <Server className="w-5 h-5 text-cyan-400" />
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <p className="font-medium">{server.name}</p>
                                      <span className="text-xs text-cyan-400 flex items-center gap-1">
                                        <Check className="w-3 h-3" />
                                        Active
                                      </span>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-0.5">{server.description || server.endpoint}</p>
                                  </div>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-red-400"
                                  onClick={() => setMcpServers(mcpServers.filter((_, i) => i !== index))}
                                  data-testid={`button-delete-mcp-${index}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                              <div className="mt-2 pt-2 border-t border-white/5">
                                <p className="text-xs text-muted-foreground font-mono truncate">{server.endpoint}</p>
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-medium text-muted-foreground">
                          Available Integrations
                        </h3>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setShowMcpForm(!showMcpForm);
                              setShowAddIntegration(false);
                            }}
                            className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                            data-testid="button-add-mcp-server"
                          >
                            <Server className="w-4 h-4 mr-2" />
                            MCP Server
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setShowAddIntegration(!showAddIntegration);
                              setShowMcpForm(false);
                            }}
                            className="border-white/10"
                            data-testid="button-add-custom-integration"
                          >
                            <Plus className="w-4 h-4 mr-2" />
                            Custom Integration
                          </Button>
                        </div>
                      </div>
                      
                      {showMcpForm && (
                        <div className="p-4 bg-gradient-to-br from-cyan-500/5 to-blue-500/5 rounded-lg border border-cyan-500/20 space-y-4">
                          <div className="flex items-center gap-2">
                            <Server className="w-5 h-5 text-cyan-400" />
                            <h4 className="font-medium">Create MCP Server</h4>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Model Context Protocol (MCP) servers allow your agent to interact with custom tools and data sources.
                          </p>
                          <div className="space-y-3">
                            <div className="space-y-2">
                              <Label className="text-sm">Server Name</Label>
                              <Input
                                value={newMcpName}
                                onChange={(e) => setNewMcpName(e.target.value)}
                                placeholder="e.g., My Custom Tools"
                                className="bg-background border-white/10"
                                data-testid="input-mcp-name"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-sm">Endpoint URL</Label>
                              <Input
                                value={newMcpEndpoint}
                                onChange={(e) => setNewMcpEndpoint(e.target.value)}
                                placeholder="e.g., https://my-mcp-server.com/api"
                                className="bg-background border-white/10 font-mono text-sm"
                                data-testid="input-mcp-endpoint"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-sm">Description (optional)</Label>
                              <Input
                                value={newMcpDescription}
                                onChange={(e) => setNewMcpDescription(e.target.value)}
                                placeholder="What does this MCP server do?"
                                className="bg-background border-white/10"
                                data-testid="input-mcp-description"
                              />
                            </div>
                          </div>
                          <div className="flex justify-end gap-2 pt-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setShowMcpForm(false);
                                setNewMcpName("");
                                setNewMcpEndpoint("");
                                setNewMcpDescription("");
                              }}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              className="bg-cyan-500 hover:bg-cyan-600"
                              onClick={() => {
                                if (newMcpName && newMcpEndpoint) {
                                  setMcpServers([...mcpServers, { 
                                    name: newMcpName, 
                                    endpoint: newMcpEndpoint, 
                                    description: newMcpDescription,
                                    status: "active" 
                                  }]);
                                  toast({
                                    title: "MCP Server Added",
                                    description: `${newMcpName} has been configured and is ready to use.`,
                                  });
                                  setNewMcpName("");
                                  setNewMcpEndpoint("");
                                  setNewMcpDescription("");
                                  setShowMcpForm(false);
                                }
                              }}
                              disabled={!newMcpName || !newMcpEndpoint}
                              data-testid="button-save-mcp-server"
                            >
                              <Server className="w-4 h-4 mr-2" />
                              Create Server
                            </Button>
                          </div>
                        </div>
                      )}
                      
                      {showAddIntegration && (
                        <div className="p-4 bg-background/50 rounded-lg border border-white/10 space-y-3">
                          <div className="space-y-2">
                            <Label className="text-sm">Integration Name</Label>
                            <Input
                              value={newIntegrationName}
                              onChange={(e) => setNewIntegrationName(e.target.value)}
                              placeholder="e.g., Custom CRM, Internal API"
                              className="bg-background border-white/10"
                              data-testid="input-custom-integration-name"
                            />
                          </div>
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setShowAddIntegration(false);
                                setNewIntegrationName("");
                              }}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => {
                                if (newIntegrationName) {
                                  setCustomIntegrations([...customIntegrations, { name: newIntegrationName, status: "pending" }]);
                                  toast({
                                    title: "Custom Integration Added",
                                    description: `${newIntegrationName} has been added. Configure credentials to complete setup.`,
                                  });
                                  setNewIntegrationName("");
                                  setShowAddIntegration(false);
                                }
                              }}
                              disabled={!newIntegrationName}
                              data-testid="button-save-custom-integration"
                            >
                              Add Integration
                            </Button>
                          </div>
                        </div>
                      )}
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {AVAILABLE_INTEGRATIONS
                          .filter(i => i.id !== 'webex' || !webexStats?.hasToken)
                          .filter(i => !connectedIntegrations.has(i.id))
                          .filter(i => integrationCategory === 'all' || i.category === integrationCategory)
                          .filter(i => 
                            !integrationSearch || 
                            i.name.toLowerCase().includes(integrationSearch.toLowerCase()) ||
                            i.description.toLowerCase().includes(integrationSearch.toLowerCase())
                          )
                          .map((integration) => (
                            <motion.div
                              key={integration.id}
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="p-4 rounded-xl border border-white/10 bg-background/30 hover:bg-background/50 hover:border-white/20 transition-all group cursor-pointer"
                              data-testid={`integration-available-${integration.id}`}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex items-center gap-3">
                                  <div className={`w-10 h-10 rounded-lg ${integration.color} flex items-center justify-center text-xl`}>
                                    {integration.icon}
                                  </div>
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                      <p className="font-medium">{integration.name}</p>
                                      {integration.popular && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 font-medium">
                                          Popular
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{integration.description}</p>
                                  </div>
                                </div>
                              </div>
                              <div className="mt-3 pt-3 border-t border-white/5 flex justify-end">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-white/10 hover:bg-primary hover:text-primary-foreground hover:border-primary"
                                  onClick={() => {
                                    const newSet = new Set(connectedIntegrations);
                                    newSet.add(integration.id);
                                    setConnectedIntegrations(newSet);
                                    toast({
                                      title: "Integration Connected",
                                      description: `${integration.name} has been added. Configure credentials in settings.`,
                                    });
                                  }}
                                  data-testid={`button-connect-${integration.id}`}
                                >
                                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                                  Connect
                                </Button>
                              </div>
                            </motion.div>
                          ))}
                      </div>
                      
                      {AVAILABLE_INTEGRATIONS
                        .filter(i => i.id !== 'webex' || !webexStats?.hasToken)
                        .filter(i => !connectedIntegrations.has(i.id))
                        .filter(i => integrationCategory === 'all' || i.category === integrationCategory)
                        .filter(i => 
                          !integrationSearch || 
                          i.name.toLowerCase().includes(integrationSearch.toLowerCase()) ||
                          i.description.toLowerCase().includes(integrationSearch.toLowerCase())
                        ).length === 0 && (
                        <div className="text-center py-8 text-muted-foreground">
                          <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
                          <p>No integrations found matching your search.</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.section>

          <motion.section 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.3 }}
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-400">
                <Code className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-2xl font-display font-semibold">Function Calling</h2>
                <p className="text-muted-foreground text-sm">Enable your agent to execute actions like sending Webex messages.</p>
              </div>
            </div>

            <div className="bg-card/30 p-6 rounded-2xl border border-white/5">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">OpenAI Function Calling</p>
                    <p className="text-sm text-muted-foreground">
                      Your agent can send Webex messages when asked using natural language.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowFunctionCode(!showFunctionCode)}
                    data-testid="button-toggle-function-code"
                  >
                    {showFunctionCode ? (
                      <>
                        <ChevronUp className="w-4 h-4 mr-2" />
                        Hide Code
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-4 h-4 mr-2" />
                        View Sample Code
                      </>
                    )}
                  </Button>
                </div>

                {showFunctionCode && (
                  <div className="space-y-4 pt-4 border-t border-white/5">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium text-orange-400">1. Define the Tool</Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => handleCopyCode(functionCallingCode.toolDefinition, 'tool')}
                          data-testid="button-copy-tool-code"
                        >
                          {copiedCode === 'tool' ? (
                            <Check className="w-3 h-3 text-green-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </Button>
                      </div>
                      <pre className="bg-black/50 rounded-lg p-4 overflow-x-auto text-xs text-green-400 font-mono">
                        <code>{functionCallingCode.toolDefinition}</code>
                      </pre>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium text-orange-400">2. Call the API with Tools</Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => handleCopyCode(functionCallingCode.apiCall, 'api')}
                          data-testid="button-copy-api-code"
                        >
                          {copiedCode === 'api' ? (
                            <Check className="w-3 h-3 text-green-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </Button>
                      </div>
                      <pre className="bg-black/50 rounded-lg p-4 overflow-x-auto text-xs text-green-400 font-mono">
                        <code>{functionCallingCode.apiCall}</code>
                      </pre>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium text-orange-400">3. Handle Tool Calls</Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => handleCopyCode(functionCallingCode.handleToolCall, 'handle')}
                          data-testid="button-copy-handle-code"
                        >
                          {copiedCode === 'handle' ? (
                            <Check className="w-3 h-3 text-green-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </Button>
                      </div>
                      <pre className="bg-black/50 rounded-lg p-4 overflow-x-auto text-xs text-green-400 font-mono">
                        <code>{functionCallingCode.handleToolCall}</code>
                      </pre>
                    </div>

                    <div className="pt-3 border-t border-white/5">
                      <p className="text-xs text-muted-foreground">
                        When you chat with your agent, it can automatically detect when you want to send a message 
                        and execute the action on your behalf.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.section>
          
          <div className="flex justify-end pt-8 border-t border-white/10">
             <Button 
              size="lg" 
              className="px-8 h-12 text-base font-medium bg-gradient-to-r from-primary to-cyan-400 hover:from-primary/90 hover:to-cyan-400/90 text-black shadow-lg shadow-cyan-500/20"
              onClick={handleCreate}
              disabled={createAgentMutation.isPending || !agentName.trim()}
              data-testid="button-create-agent"
             >
               {createAgentMutation.isPending ? (
                 <>Creating Agent...</>
               ) : (
                 <>Create Agent <Sparkles className="w-4 h-4 ml-2" /></>
               )}
             </Button>
          </div>
          </>
          )}

        </div>
      </main>
    </div>
  );
}
