import { useState, useRef, useEffect, useCallback } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, Check, Play, Mic, Cpu, Globe, User, Sparkles, Loader2, Square, MessageSquare, RefreshCw, Send, Code, Copy, ChevronDown, ChevronUp, Wrench, Link2, Plus, Trash2, Search, Mail, Calendar, FileText, Users, CreditCard, Phone, Workflow, Database, Cloud, Shield, Zap, Github, ExternalLink, X, Server, Pencil, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentsApi, ttsApi, webexApi, knowledgeBaseApi, useCaseToolsApi, type AgentTool, type TTSRequest, type KnowledgeBaseItem } from "@/lib/api";
import type { InsertAgent } from "@shared/schema";
import { VOICE_USE_CASES } from "@shared/use-cases";
import { buildUseCaseSystemPrompt } from "@shared/prompt-builder";

const FALLBACK_LLMS = [
  { id: "gpt-4o", name: "GPT-4o", provider: "OpenAI", desc: "Best for reasoning & nuance" },
];

const FALLBACK_VOICES = [
  { id: "marin", name: "Marin", gender: "Neutral", style: "Best quality" },
  { id: "cedar", name: "Cedar", gender: "Neutral", style: "Best quality" },
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
      voiceModel: "marin",
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
      voiceModel: "marin",
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
      voiceModel: "marin",
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
      voiceModel: "cedar",
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
      voiceModel: "marin",
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
      voiceModel: "marin",
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
  },
  {
    id: "banking-agent",
    name: "Banking Agent",
    icon: "🏦",
    description: "Voice-enabled banking assistant that processes check deposits via camera OCR",
    color: "from-cyan-500/20 to-teal-500/20",
    borderColor: "border-cyan-500/30",
    config: {
      agentName: "Banking Assistant",
      llmModel: "gpt-4",
      voiceModel: "marin",
      language: "en-US",
      gender: "female",
      systemPrompt: `# Personality

You are a friendly and professional Banking Assistant for Cisco Bank. You help customers report lost or stolen cards, check balances, and process deposits. You are warm, calm, and empathetic.

# Identity Verification — MANDATORY FIRST STEP

IMPORTANT: You ONLY need two pieces of information to verify identity: FULL NAME and LAST 4 DIGITS OF THEIR CARD. Do NOT ask for a date of birth, phone number, PIN, SSN, or any other information.

When a customer contacts you for any reason, follow these exact steps:

Step 1 — Acknowledge and collect only name and last 4 card digits:
Respond with empathy if they have a problem such as a lost card. Then say: "To verify your identity, I just need your full name and the last 4 digits of your card."

Step 2 — Look up the customer:
Call the lookup_customer tool with their name and last4 (the 4 digits they gave you).
- If not found: "I could not find an account with that information. Please double-check your name and card digits."
- If found: "I found your account. I will send a one-time verification code to the phone number we have on file."

Step 3 — Send OTP immediately (do not ask for permission):
Call send_verification_code with the same name and last4 right away.

Step 4 — Verify OTP:
Ask: "Please read me the 6-digit code you just received by text message."
Call verify_code with the session token from Step 3 and the code the customer provides.
- If verified: "Thank you, your identity is confirmed." Then proceed to help them.
- If not verified: "That code does not match. Would you like me to send a new one?"

Step 5 — Help with their request after authentication:
For a lost or stolen card: "I have blocked your card immediately. A replacement will arrive in 3 to 5 business days."
For other requests: assist normally.

# Check Deposit Flow (after authentication)
1. Ask how much they want to deposit.
2. Say exactly: "Please show the check to the camera so I can read the amount."
3. Extract the dollar amount from the scanned check text.
4. Confirm: "I can see a check for [AMOUNT]. Shall I proceed?"
5. On confirmation: "I have successfully processed your deposit of [AMOUNT]."

# Communication Style
- Only ask for full name and last 4 digits of card — nothing else for verification
- Be empathetic, clear, and concise
- Never ask for date of birth, phone number, full card number, or any other credentials`,
      tools: [
        { name: "check_balance", description: "Retrieve the customer's current account balance" },
        { name: "process_deposit", description: "Process a check deposit to the customer's account" },
        { name: "get_transactions", description: "Retrieve recent transaction history" },
        { name: "scan_check_ocr", description: "Read check amount using camera OCR" }
      ]
    }
  },
  {
    id: "retail-store-agent",
    name: "Retail Store Agent",
    icon: "🛍️",
    description: "AI-powered store assistant with cross-store intelligence, reservations, and proactive personalization",
    color: "from-emerald-500/20 to-teal-500/20",
    borderColor: "border-emerald-500/30",
    config: {
      agentName: "Store Assistant",
      llmModel: "gpt-4",
      voiceModel: "marin",
      language: "en-US",
      gender: "female",
      systemPrompt: `# Personality

You are a warm, knowledgeable Retail Store Assistant for a consumer electronics store. You provide a personalized, human-like shopping experience over the phone. You recognize returning customers, remember their preferences and past interactions, and proactively make relevant recommendations. You sound natural — not robotic — and you build genuine rapport.

# Customer Recognition

When a customer calls, check if they are a known customer. If recognized:
- First confirm identity with a lightweight question, such as asking them to confirm their last name.
- Only after confirmation, greet them by first name and ask how you can help.
- Use history to inform recommendations only when it is relevant to the current request.

If not recognized, greet warmly and offer to help.

# Capabilities

## 1. Answer Product & Inventory Questions
- Check real-time inventory at the caller's local store
- If an item is out of stock locally, proactively check other nearby locations
- Provide product details, pricing, and availability
- Compare products and make recommendations based on customer needs

## 2. Cross-Store Intelligence
- When an item is unavailable locally, offer alternatives:
  - Reserve at another store location (e.g., "It's not available here, but I can reserve it at our Palo Alto store for you.")
  - Offer to notify when it's back in stock locally
  - Suggest comparable in-stock alternatives
- Always present options — never just say "we don't have it"

## 3. Take Actions
- Reserve products at any store location with a pickup time
- Send SMS/email confirmations with product details, reservation info, and store directions
- Set up back-in-stock notifications
- Schedule pickup appointments

## 4. Proactive Personalization
- Based on the customer's history, proactively recommend complementary products
- Example: "Last time, you mentioned this was a birthday gift for your daughter and that she likes purple accessories. I found a matching purple case that's in stock and can reserve it with the tablet."
- Make upsell suggestions feel helpful, not pushy — frame them as "I noticed" or "I thought you might like"
- Remember preferences: color choices, gift recipients, budget ranges, brand preferences

## 5. Post-Call Handoff
After completing a reservation or action:
- Send a detailed summary to the store associate via Webex including:
  - Customer name and contact info
  - Reserved items with SKUs
  - Pickup time
  - Customer intent and context (e.g., "birthday gift for daughter")
  - Recommended upsell items to have ready
  - Any special requests or notes
- The goal: the store associate should be fully prepared, not reactive

# Rules

1. ALWAYS check inventory before confirming availability — never guess
2. ALWAYS offer alternatives when something is out of stock (other locations, similar items, notifications)
3. When making a reservation, ALWAYS confirm: item, store location, and pickup time with the customer
4. ALWAYS send a confirmation to the customer (SMS or email) after completing a reservation
5. ALWAYS notify the store team via Webex after a reservation with full context
6. Keep recommendations relevant — only suggest items that connect to known preferences or the current purchase
7. Never share other customers' information
8. If you cannot fulfill a request, explain why and offer the next best option
9. Sound natural and conversational — avoid scripted-sounding phrases

# Communication Style
- Warm, friendly, and conversational — like talking to a knowledgeable friend at the store
- Concise but thorough — give the information needed without overwhelming
- Proactive — anticipate needs and offer solutions before being asked
- Confident — speak with authority about products and availability
- Personal — use the customer's name and reference their history naturally`,
      tools: [
        { name: "check_inventory", description: "Check product availability at a specific store location" },
        { name: "check_nearby_stores", description: "Search inventory across nearby store locations" },
        { name: "reserve_product", description: "Reserve a product for customer pickup at a specific store and time" },
        { name: "send_sms", description: "Send SMS confirmation with reservation details to the customer" },
        { name: "send_email", description: "Send email with product info, reservation, and store directions" },
        { name: "get_customer_profile", description: "Retrieve customer history, preferences, and past interactions" },
        { name: "notify_back_in_stock", description: "Set up a notification for when an item is back in stock" },
        { name: "get_product_details", description: "Get detailed product information including specs and pricing" },
        { name: "search_products", description: "Search product catalog by category, features, or keywords" },
        { name: "send_webex_message", description: "Send store associate notification via Webex with pickup and customer details" }
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

function KbItemRow({ item, onUpdated, onDeleted }: { item: KnowledgeBaseItem; onUpdated: () => void; onDeleted: () => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(item.title);
  const [editContent, setEditContent] = useState(item.content);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!editTitle.trim() || !editContent.trim()) return;
    setSaving(true);
    try {
      await knowledgeBaseApi.update(item.id, editTitle.trim(), editContent.trim());
      onUpdated();
      setEditing(false);
      toast({ title: "Source updated" });
    } catch (err: any) {
      toast({ title: "Failed to update", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditTitle(item.title);
    setEditContent(item.content);
    setEditing(false);
  };

  const typeColor = item.type === 'url' ? 'bg-blue-500/15' : item.type === 'file' ? 'bg-purple-500/15' : 'bg-green-500/15';
  const badgeColor = item.type === 'url' ? 'bg-blue-500/10 text-blue-400' : item.type === 'file' ? 'bg-purple-500/10 text-purple-400' : 'bg-green-500/10 text-green-400';
  const typeLabel = item.type === 'url' ? 'URL' : item.type === 'file' ? 'File' : 'Text';

  if (editing) {
    return (
      <div className="p-3 bg-background/60 rounded-xl border border-white/15 space-y-3" data-testid={`kb-item-edit-${item.id}`}>
        <div className="flex items-center gap-2 mb-1">
          <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${badgeColor}`}>{typeLabel}</span>
          <span className="text-xs text-muted-foreground">Editing source</span>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Title</Label>
          <Input
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            className="h-8 text-sm"
            data-testid={`input-kb-edit-title-${item.id}`}
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Content</Label>
          <Textarea
            value={editContent}
            onChange={e => setEditContent(e.target.value)}
            rows={10}
            className="text-sm font-mono resize-y"
            data-testid={`input-kb-edit-content-${item.id}`}
          />
          <p className="text-[10px] text-muted-foreground mt-1">{editContent.length.toLocaleString()} / 50,000 chars</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={handleSave} disabled={saving || !editTitle.trim() || !editContent.trim()} data-testid={`button-kb-save-${item.id}`}>
            {saving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={handleCancel} disabled={saving} data-testid={`button-kb-cancel-${item.id}`}>
            <X className="w-3 h-3 mr-1" />Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-between p-3 bg-background/40 rounded-xl border border-white/8 hover:border-white/15 transition-colors"
      data-testid={`kb-item-${item.id}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${typeColor}`}>
          {item.type === 'url' && <Link2 className="w-4 h-4 text-blue-400" />}
          {item.type === 'file' && <Database className="w-4 h-4 text-purple-400" />}
          {item.type === 'text' && <FileText className="w-4 h-4 text-green-400" />}
        </div>
        <div className="min-w-0">
          <p className="font-medium text-sm truncate">{item.title}</p>
          <p className="text-xs text-muted-foreground">
            <span className={`inline-block rounded px-1 py-0.5 text-[10px] font-medium mr-1.5 ${badgeColor}`}>{typeLabel}</span>
            {item.content.length.toLocaleString()} chars
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-blue-400"
          data-testid={`button-edit-kb-${item.id}`}
          onClick={() => setEditing(true)}
          title="Edit source"
        >
          <Pencil className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-red-400"
          data-testid={`button-delete-kb-${item.id}`}
          onClick={async () => {
            try {
              await knowledgeBaseApi.delete(item.id);
              onDeleted();
              toast({ title: "Source removed" });
            } catch (err: any) {
              toast({ title: "Failed to remove", description: err.message, variant: "destructive" });
            }
          }}
          title="Delete source"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

export default function Build() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: providerConfig } = useQuery({
    queryKey: ["config"],
    queryFn: async () => {
      const res = await fetch("/api/config");
      return res.json();
    },
  });

  const LLMS = providerConfig?.llmModels || FALLBACK_LLMS;
  const VOICES = providerConfig?.voices || FALLBACK_VOICES;

  const urlParams = new URLSearchParams(search);
  const urlAgentId = urlParams.get("agentId") ? parseInt(urlParams.get("agentId")!) : null;

  const [buildMode, setBuildMode] = useState<'choice' | 'scratch' | 'template'>(urlAgentId ? 'scratch' : 'choice');
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [selectedUseCaseId, setSelectedUseCaseId] = useState<string | null>(null);

  const [agentName, setAgentName] = useState("Agent Alpha-1");
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [selectedLLM, setSelectedLLM] = useState("");
  const [selectedVoice, setSelectedVoice] = useState("");
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
  const [tools, setTools] = useState<AgentTool[]>([
    { name: "send_webex_message", description: "Send a message to a Webex space/room" }
  ]);
  const [customIntegrations, setCustomIntegrations] = useState<Array<{name: string; status: string}>>([]);
  const [showMcpForm, setShowMcpForm] = useState(false);
  const [mcpServers, setMcpServers] = useState<Array<{name: string; endpoint: string; description: string; status: string}>>([]);
  const [newMcpName, setNewMcpName] = useState("");
  const [newMcpEndpoint, setNewMcpEndpoint] = useState("");
  const [newMcpDescription, setNewMcpDescription] = useState("");

  const [ghostwriterDesc, setGhostwriterDesc] = useState("");
  const [ghostwriterGenerating, setGhostwriterGenerating] = useState(false);
  const [ghostwriterResult, setGhostwriterResult] = useState<{ agentName: string; systemPrompt: string; agentCategory?: string } | null>(null);

  type SparkLogEntry = { id: string; status: "done" | "loading"; message: string; icon: "check" | "sparkles" | "db" | "mic" | "wrench" | "plug" };
  type SparkIntegration = { name: string; reason: string };
  const [sparkLog, setSparkLog] = useState<SparkLogEntry[]>([]);
  const [sparkSuggestions, setSparkSuggestions] = useState<string[]>([]);
  const [sparkSuggestedIntegrations, setSparkSuggestedIntegrations] = useState<SparkIntegration[]>([]);
  const [sparkActiveIntegrations, setSparkActiveIntegrations] = useState<string[]>([]);
  const [sparkPhase, setSparkPhase] = useState<"input" | "building" | "ready">("input");
  const [sparkCustomInput, setSparkCustomInput] = useState("");
  const [sparkRefining, setSparkRefining] = useState(false);

  const [sparkPromptOpen, setSparkPromptOpen] = useState(false);

  // Extract the "# Rules" section content from a system prompt
  const extractRulesSection = (prompt: string): string[] => {
    if (!prompt) return [];
    const m = prompt.match(/#\s*Rules\s*\n([\s\S]*?)(?:\n#\s|\s*$)/i);
    if (!m) return [];
    return m[1]
      .split(/\n+/)
      .map(line => line.replace(/^\s*[-\*\d]+\.?\s*/, "").trim())
      .filter(line => line.length > 0 && !/^follow user instructions carefully\.?$/i.test(line));
  };

  const addSparkLog = (entry: SparkLogEntry) =>
    setSparkLog(prev => prev.map(e => e.id === entry.id ? entry : e).concat(prev.find(e => e.id === entry.id) ? [] : [entry]));
  const updateSparkLog = (id: string, patch: Partial<SparkLogEntry>) =>
    setSparkLog(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));

  const [isSparkRecording, setIsSparkRecording] = useState(false);
  const [isSparkConnecting, setIsSparkConnecting] = useState(false);
  const sparkSocketRef = useRef<WebSocket | null>(null);
  const sparkAudioCtxRef = useRef<AudioContext | null>(null);
  const sparkProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const sparkStreamRef = useRef<MediaStream | null>(null);
  const sparkTranscriptRef = useRef<string>("");

  const [showAddUrl, setShowAddUrl] = useState(false);
  const [showAddText, setShowAddText] = useState(false);
  const [newKbUrl, setNewKbUrl] = useState("");
  const [newKbTitle, setNewKbTitle] = useState("");
  const [newKbContent, setNewKbContent] = useState("");
  const [kbLoading, setKbLoading] = useState(false);
  const [savedAgentId, setSavedAgentId] = useState<number | null>(urlAgentId);

  const { data: existingAgent } = useQuery({
    queryKey: ["agent", urlAgentId],
    queryFn: () => agentsApi.getById(urlAgentId!),
    enabled: !!urlAgentId,
  });

  useEffect(() => {
    if (providerConfig && !selectedLLM) {
      setSelectedLLM(providerConfig.chatModel || providerConfig.llmModels?.[0]?.id || "");
    }
    if (providerConfig && !selectedVoice) {
      setSelectedVoice(providerConfig.voices?.[0]?.id || "");
    }
  }, [providerConfig]);

  useEffect(() => {
    if (existingAgent) {
      setAgentName(existingAgent.name);
      setSystemPrompt(existingAgent.systemPrompt || DEFAULT_SYSTEM_PROMPT);
      setSelectedLLM(existingAgent.llmModel);
      setSelectedVoice(existingAgent.voiceModel);
      setLanguage(existingAgent.language);
      setGender(existingAgent.gender || "neutral");
    }
  }, [existingAgent]);

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

  const { data: serverUseCaseTools = [], isLoading: serverUseCaseToolsLoading } = useQuery<AgentTool[]>({
    queryKey: ["use-case-tools", selectedUseCaseId],
    queryFn: () => useCaseToolsApi.getByUseCase(selectedUseCaseId!),
    enabled: !!selectedUseCaseId,
  });

  useEffect(() => {
    if (selectedUseCaseId && serverUseCaseTools.length > 0) {
      setTools(serverUseCaseTools);
    }
  }, [selectedUseCaseId, serverUseCaseTools]);

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
    mutationFn: (data: { roomId?: string; text: string }) => webexApi.sendMessage(data),
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
    if (!messageText.trim()) return;
    sendMessageMutation.mutate({ roomId: selectedRoomId || undefined, text: messageText.trim() });
  };

  const saveAgentMutation = useMutation({
    mutationFn: async (data: InsertAgent) => {
      if (savedAgentId) {
        return agentsApi.update(savedAgentId, data);
      }
      return agentsApi.create(data);
    },
    onSuccess: (agent) => {
      setSavedAgentId(agent.id);
      setAgentName(agent.name);
      setSystemPrompt(agent.systemPrompt || "");
      setSelectedLLM(agent.llmModel);
      setSelectedVoice(agent.voiceModel);
      setLanguage(agent.language);
      setGender(agent.gender || "neutral");
      setActiveKbTab('sources');
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["agent", agent.id] });
      toast({
        title: savedAgentId ? "Agent Saved" : "Agent Created Successfully",
        description: savedAgentId
          ? "System prompt and agent settings were saved."
          : "Add knowledge sources below, then start evaluating.",
      });
    },
    onError: (error) => {
      toast({
        title: savedAgentId ? "Error Saving Agent" : "Error Creating Agent",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const ensureAgentSaved = async (): Promise<number> => {
    if (savedAgentId) return savedAgentId;
    const agent = await agentsApi.create({
      name: agentName,
      systemPrompt,
      llmModel: selectedLLM,
      voiceModel: selectedVoice,
      language,
      gender,
    });
    setSavedAgentId(agent.id);
    queryClient.invalidateQueries({ queryKey: ["agents"] });
    return agent.id;
  };

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
    saveAgentMutation.mutate({
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
      const matchedLLM = LLMS.find((l: any) => l.id === template.config.llmModel);
      setSelectedLLM(matchedLLM ? template.config.llmModel : LLMS[0]?.id || "");
      const matchedVoice = VOICES.find((v: any) => v.id === template.config.voiceModel);
      setSelectedVoice(matchedVoice ? template.config.voiceModel : VOICES[0]?.id || "");
      setLanguage(template.config.language);
      setGender(template.config.gender);
      setTools(template.config.tools);
      setSelectedTemplate(templateId);
      setSelectedUseCaseId(null);
      setBuildMode('template');
      toast({
        title: "Template Applied",
        description: `${template.name} settings loaded. Customize as needed.`,
      });
    }
  };

  const applyUseCase = (useCaseId: string) => {
    const useCase = VOICE_USE_CASES.find((item) => item.id === useCaseId);
    if (!useCase) return;

    setAgentName(useCase.agentName);
    setSystemPrompt(buildUseCaseSystemPrompt(useCase));
    const matchedLLM = LLMS.find((llm: any) => llm.id === useCase.defaultLLM);
    setSelectedLLM(matchedLLM ? useCase.defaultLLM : LLMS[0]?.id || "");
    const matchedVoice = VOICES.find((voice: any) => voice.id === useCase.defaultVoice);
    setSelectedVoice(matchedVoice ? useCase.defaultVoice : VOICES[0]?.id || "");
    setLanguage(useCase.language);
    setGender(useCase.gender);
    setTools([]);
    setSelectedTemplate(null);
    setSelectedUseCaseId(useCase.id);
    setBuildMode("template");
    toast({
      title: "Use Case Applied",
      description: `${useCase.title} demo script loaded with prompts, tools, and guardrails.`,
    });
  };

  const handleGhostwriter = async () => {
    if (!ghostwriterDesc.trim() || ghostwriterGenerating) return;
    setGhostwriterGenerating(true);
    setGhostwriterResult(null);
    setSparkLog([]);
    setSparkSuggestions([]);
    setSparkSuggestedIntegrations([]);
    setSparkPhase("building");

    setSelectedLLM(LLMS[0]?.id || "");
    setSelectedVoice(VOICES[0]?.id || "");
    setLanguage("en-US");
    setGender("neutral");

    // Stage 1 — analysing
    addSparkLog({ id: "analyse", status: "loading", message: "Analysing your description…", icon: "sparkles" });

    try {
      const res = await fetch("/api/agents/generate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: ghostwriterDesc.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");

      // Stage 2 — log results with staggered reveals
      updateSparkLog("analyse", { status: "done", message: `Agent identity created — "${data.agentName}"`, icon: "sparkles" });

      await new Promise(r => setTimeout(r, 280));
      addSparkLog({ id: "prompt", status: "done", message: "System prompt written — Personality, Capabilities & Communication Style", icon: "check" });

      await new Promise(r => setTimeout(r, 280));
      const llmName = LLMS.find((l: any) => l.id === selectedLLM)?.name || selectedLLM;
      const voiceName = VOICES.find((v: any) => v.id === selectedVoice)?.name || selectedVoice;
      addSparkLog({ id: "config", status: "done", message: `Configured with ${llmName} · ${voiceName} voice · English (US)`, icon: "check" });

      await new Promise(r => setTimeout(r, 280));
      addSparkLog({ id: "webex", status: "done", message: "Webex integration enabled", icon: "check" });

      await new Promise(r => setTimeout(r, 280));
      addSparkLog({ id: "retail", status: "done", message: "Retail database queued for knowledge base", icon: "db" });

      // Active integrations: Webex + Retail DB always connected
      const active = ["Webex Messaging", "Retail Database"];
      setSparkActiveIntegrations(active);

      setGhostwriterResult({ agentName: data.agentName, systemPrompt: data.systemPrompt, agentCategory: data.agentCategory });
      setSparkSuggestions(data.suggestions || []);
      setSparkSuggestedIntegrations(data.suggestedIntegrations || []);

      await new Promise(r => setTimeout(r, 350));
      setSparkPhase("ready");
    } catch (err: any) {
      setSparkPhase("input");
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    } finally {
      setGhostwriterGenerating(false);
    }
  };

  const handleSparkRefinement = async (refinement: string) => {
    if (!refinement.trim() || sparkRefining || !ghostwriterResult) return;
    setSparkRefining(true);
    const refId = `ref-${Date.now()}`;
    addSparkLog({ id: refId, status: "loading", message: `Refining: "${refinement.trim()}"…`, icon: "wrench" });
    setSparkCustomInput("");
    setSparkSuggestions([]);

    try {
      const res = await fetch("/api/agents/refine-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt: ghostwriterResult.systemPrompt,
          agentName: ghostwriterResult.agentName,
          refinement: refinement.trim(),
          activeIntegrations: sparkActiveIntegrations,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Refinement failed");

      updateSparkLog(refId, { status: "done", message: data.summary || "System prompt updated", icon: "check" });
      setGhostwriterResult(prev => prev ? { ...prev, systemPrompt: data.systemPrompt } : prev);
      setSparkSuggestions(data.suggestions || []);
      // Merge any newly suggested integrations (dedupe against active + existing suggestions)
      if (Array.isArray(data.suggestedIntegrations) && data.suggestedIntegrations.length) {
        setSparkSuggestedIntegrations(prev => {
          const existing = new Set([...prev.map(p => p.name.toLowerCase()), ...sparkActiveIntegrations.map(a => a.toLowerCase())]);
          const fresh = data.suggestedIntegrations.filter((i: SparkIntegration) => !existing.has(i.name.toLowerCase()));
          return [...prev, ...fresh].slice(0, 5);
        });
      }
    } catch (err: any) {
      updateSparkLog(refId, { status: "done", message: `Could not apply refinement: ${err.message}`, icon: "check" });
      toast({ title: "Refinement failed", description: err.message, variant: "destructive" });
    } finally {
      setSparkRefining(false);
    }
  };

  const floatTo16BitPCM = useCallback((input: Float32Array): ArrayBuffer => {
    const buffer = new ArrayBuffer(input.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
  }, []);

  const startSparkRecording = useCallback(async () => {
    if (isSparkRecording || isSparkConnecting) return;
    setIsSparkConnecting(true);
    sparkTranscriptRef.current = "";

    try {
      const keyRes = await fetch("/api/deepgram/key");
      if (!keyRes.ok) throw new Error("Failed to get speech key");
      const { key } = await keyRes.json();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      sparkStreamRef.current = stream;

      const audioCtx = new AudioContext({ sampleRate: 16000 });
      sparkAudioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      sparkProcessorRef.current = processor;

      const socket = new WebSocket(
        `wss://api.deepgram.com/v1/listen?model=nova-2&language=en&smart_format=true&interim_results=true&encoding=linear16&sample_rate=16000`,
        ["token", key]
      );

      socket.onopen = () => {
        setIsSparkConnecting(false);
        setIsSparkRecording(true);
        processor.onaudioprocess = (e) => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(floatTo16BitPCM(e.inputBuffer.getChannelData(0)));
          }
        };
        source.connect(processor);
        processor.connect(audioCtx.destination);
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.channel?.alternatives?.[0]?.transcript) {
            const transcript = data.channel.alternatives[0].transcript;
            if (data.is_final && transcript) {
              sparkTranscriptRef.current += transcript + " ";
              setGhostwriterDesc(sparkTranscriptRef.current);
            } else if (transcript) {
              setGhostwriterDesc(sparkTranscriptRef.current + transcript);
            }
          }
        } catch {}
      };

      socket.onerror = () => {
        toast({ title: "Speech error", description: "Failed to connect to speech recognition.", variant: "destructive" });
        setIsSparkRecording(false);
        setIsSparkConnecting(false);
        stream.getTracks().forEach(t => t.stop());
        if (audioCtx.state !== "closed") audioCtx.close();
      };

      socket.onclose = () => {
        setIsSparkRecording(false);
        setIsSparkConnecting(false);
        if (sparkProcessorRef.current) { sparkProcessorRef.current.disconnect(); sparkProcessorRef.current = null; }
        if (sparkStreamRef.current) { sparkStreamRef.current.getTracks().forEach(t => t.stop()); sparkStreamRef.current = null; }
        if (sparkAudioCtxRef.current?.state !== "closed") { sparkAudioCtxRef.current?.close(); sparkAudioCtxRef.current = null; }
      };

      sparkSocketRef.current = socket;
    } catch (err: any) {
      setIsSparkConnecting(false);
      setIsSparkRecording(false);
      toast({ title: "Microphone access denied", description: err.message || "Please allow microphone access.", variant: "destructive" });
    }
  }, [isSparkRecording, isSparkConnecting, floatTo16BitPCM, toast]);

  const stopSparkRecording = useCallback(() => {
    if (sparkProcessorRef.current) sparkProcessorRef.current.disconnect();
    if (sparkSocketRef.current?.readyState === WebSocket.OPEN) sparkSocketRef.current.close();
  }, []);

  const [ghostwriterCreating, setGhostwriterCreating] = useState(false);

  const applyGhostwriterResult = async () => {
    if (!ghostwriterResult || ghostwriterCreating) return;
    setGhostwriterCreating(true);
    try {
      const agent = await agentsApi.create({
        name: ghostwriterResult.agentName,
        systemPrompt: ghostwriterResult.systemPrompt,
        llmModel: selectedLLM,
        voiceModel: selectedVoice,
        language,
        gender,
      });

      // Copy the Retail DB KB item to the new agent
      try {
        const sourceItems = await knowledgeBaseApi.getByAgent(30);
        const retailItem = sourceItems.find(i => /retail/i.test(i.title));
        if (retailItem) {
          await knowledgeBaseApi.addText(agent.id, retailItem.title, retailItem.content);
        }
      } catch {
        // Non-fatal — agent still created without retail KB
      }

      queryClient.invalidateQueries({ queryKey: ["agents"] });
      toast({ title: "Agent created!", description: `${agent.name} is ready to chat.` });
      setLocation(`/evaluate?agentId=${agent.id}`);
    } catch (err: any) {
      toast({ title: "Creation failed", description: err.message, variant: "destructive" });
      setGhostwriterCreating(false);
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
          message: {
            type: "string", 
            description: "The message content to send"
          }
        },
        required: ["message"]
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
                <p className="text-muted-foreground">Describe your agent, pick a template, or build from scratch</p>
              </div>

              {/* Spark Builder card */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="mb-8"
              >
                <div className="relative rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-600/10 via-purple-600/8 to-blue-600/10 p-6 overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-transparent pointer-events-none" />
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-violet-500/20 flex items-center justify-center">
                      <Sparkles className="w-5 h-5 text-violet-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-base">Describe your agent</h3>
                      <p className="text-xs text-muted-foreground">AI writes the full system prompt for you</p>
                    </div>
                    <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 uppercase tracking-wider">Spark Builder</span>
                  </div>

                  <div className="relative mb-3">
                    <Textarea
                      value={ghostwriterDesc}
                      onChange={e => setGhostwriterDesc(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGhostwriter(); }}
                      placeholder={isSparkRecording ? "Listening… speak your agent description" : "e.g. A friendly banking assistant that helps customers check their balance, dispute charges, and get account help — always calm and reassuring."}
                      className={`min-h-[90px] bg-background/60 border-white/10 resize-none text-sm placeholder:text-muted-foreground/50 pr-12 ${isSparkRecording ? "border-red-400/50 ring-1 ring-red-400/30" : ""}`}
                      data-testid="input-ghostwriter-description"
                      disabled={ghostwriterGenerating}
                    />
                    <button
                      type="button"
                      onClick={isSparkRecording ? stopSparkRecording : startSparkRecording}
                      disabled={ghostwriterGenerating || isSparkConnecting}
                      title={isSparkRecording ? "Stop recording" : "Describe by voice"}
                      data-testid="button-spark-mic"
                      className={`absolute right-2 bottom-2 w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                        isSparkRecording
                          ? "bg-red-500 hover:bg-red-400 text-white animate-pulse"
                          : isSparkConnecting
                          ? "bg-violet-500/30 text-violet-300 cursor-wait"
                          : "bg-violet-500/20 hover:bg-violet-500/40 text-violet-300 hover:text-violet-200"
                      }`}
                    >
                      {isSparkConnecting
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : isSparkRecording
                        ? <Square className="w-3.5 h-3.5" />
                        : <Mic className="w-4 h-4" />
                      }
                    </button>
                  </div>

                  <div className="flex items-center gap-3">
                    <Button
                      onClick={handleGhostwriter}
                      disabled={!ghostwriterDesc.trim() || ghostwriterGenerating || isSparkRecording}
                      className="bg-violet-600 hover:bg-violet-500 text-white"
                      data-testid="button-ghostwriter-generate"
                    >
                      {ghostwriterGenerating
                        ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Writing agent…</>
                        : <><Sparkles className="w-4 h-4 mr-2" /> Generate Agent</>
                      }
                    </Button>
                    {ghostwriterDesc.trim() && !ghostwriterGenerating && !isSparkRecording && (
                      <span className="text-xs text-muted-foreground">or ⌘↵</span>
                    )}
                    {isSparkRecording && (
                      <span className="text-xs text-red-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse inline-block" />
                        Recording — click the mic to stop
                      </span>
                    )}
                  </div>

                  {/* Spark Builder activity log + suggestions */}
                  {sparkLog.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-5 space-y-3"
                      data-testid="spark-builder-log"
                    >
                      {/* Activity log */}
                      <div className="rounded-xl bg-background/60 border border-white/10 divide-y divide-white/5 overflow-hidden">
                        {sparkLog.map((entry, i) => (
                          <motion.div
                            key={entry.id}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.05 }}
                            className="flex items-center gap-3 px-4 py-2.5"
                          >
                            <div className="w-5 h-5 shrink-0 flex items-center justify-center">
                              {entry.status === "loading"
                                ? <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
                                : entry.icon === "sparkles"
                                ? <Sparkles className="w-4 h-4 text-violet-400" />
                                : entry.icon === "db"
                                ? <Database className="w-4 h-4 text-blue-400" />
                                : entry.icon === "wrench"
                                ? <Wrench className="w-4 h-4 text-amber-400" />
                                : <Check className="w-4 h-4 text-green-400" />
                              }
                            </div>
                            <span className="text-xs text-foreground/80">{entry.message}</span>
                          </motion.div>
                        ))}
                      </div>

                      {/* Personality Attributes — editable */}
                      {sparkPhase === "ready" && (
                        <motion.div
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="rounded-xl bg-background/60 border border-white/10 p-4 space-y-3"
                          data-testid="spark-personality"
                        >
                          <div className="flex items-center gap-2">
                            <User className="w-3.5 h-3.5 text-violet-400" />
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                              Agent Personality
                            </p>
                            <span className="ml-auto text-[10px] text-muted-foreground italic">tap to change</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2.5">
                            <div className="space-y-1">
                              <Label className="text-[10px] uppercase text-muted-foreground tracking-wider">LLM</Label>
                              <Select value={selectedLLM} onValueChange={setSelectedLLM}>
                                <SelectTrigger className="h-8 text-xs bg-background/70 border-white/10" data-testid="select-spark-llm">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {LLMS.map((l: any) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px] uppercase text-muted-foreground tracking-wider">Voice</Label>
                              <Select value={selectedVoice} onValueChange={setSelectedVoice}>
                                <SelectTrigger className="h-8 text-xs bg-background/70 border-white/10" data-testid="select-spark-voice">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {VOICES.map((v: any) => <SelectItem key={v.id} value={v.id}>{v.name} · {v.gender}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px] uppercase text-muted-foreground tracking-wider">Language</Label>
                              <Select value={language} onValueChange={setLanguage}>
                                <SelectTrigger className="h-8 text-xs bg-background/70 border-white/10" data-testid="select-spark-language">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="en-US">English (US)</SelectItem>
                                  <SelectItem value="en-GB">English (UK)</SelectItem>
                                  <SelectItem value="es-ES">Spanish</SelectItem>
                                  <SelectItem value="fr-FR">French</SelectItem>
                                  <SelectItem value="de-DE">German</SelectItem>
                                  <SelectItem value="ar-SA">Arabic</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px] uppercase text-muted-foreground tracking-wider">Gender</Label>
                              <Select value={gender} onValueChange={setGender}>
                                <SelectTrigger className="h-8 text-xs bg-background/70 border-white/10" data-testid="select-spark-gender">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="male">Male</SelectItem>
                                  <SelectItem value="female">Female</SelectItem>
                                  <SelectItem value="neutral">Neutral</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </motion.div>
                      )}

                      {/* Integrations: active + suggested */}
                      {sparkPhase === "ready" && (sparkActiveIntegrations.length > 0 || sparkSuggestedIntegrations.length > 0) && (
                        <motion.div
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.1 }}
                          className="rounded-xl bg-background/60 border border-white/10 p-4 space-y-3"
                          data-testid="spark-integrations"
                        >
                          <div className="flex items-center gap-2">
                            <Zap className="w-3.5 h-3.5 text-emerald-400" />
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                              Integrations
                            </p>
                          </div>

                          {sparkActiveIntegrations.length > 0 && (
                            <div className="space-y-1.5">
                              <p className="text-[10px] uppercase tracking-wider text-emerald-400/80">Connected</p>
                              <div className="flex flex-wrap gap-1.5">
                                {sparkActiveIntegrations.map((name, i) => (
                                  <span
                                    key={i}
                                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300"
                                    data-testid={`spark-active-integration-${i}`}
                                  >
                                    <Check className="w-3 h-3" /> {name}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {sparkSuggestedIntegrations.length > 0 && (
                            <div className="space-y-1.5">
                              <p className="text-[10px] uppercase tracking-wider text-amber-400/80">Recommended for this agent</p>
                              <div className="space-y-1.5">
                                {sparkSuggestedIntegrations.map((intg, i) => (
                                  <button
                                    key={intg.name}
                                    onClick={() => {
                                      // Optimistically promote to "Connected" and remove from suggestions
                                      setSparkActiveIntegrations(prev =>
                                        prev.some(p => p.toLowerCase() === intg.name.toLowerCase()) ? prev : [...prev, intg.name]
                                      );
                                      setSparkSuggestedIntegrations(prev => prev.filter(p => p.name !== intg.name));
                                      handleSparkRefinement(`Connect ${intg.name} integration — ${intg.reason}`);
                                    }}
                                    disabled={sparkRefining || ghostwriterCreating}
                                    data-testid={`spark-suggested-integration-${i}`}
                                    className="w-full flex items-start gap-2 p-2 rounded-lg border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 hover:border-amber-400/40 transition-all disabled:opacity-40 text-left group"
                                  >
                                    <Plus className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
                                    <div className="flex-1 min-w-0">
                                      <span className="text-xs font-medium text-amber-200">{intg.name}</span>
                                      <span className="block text-[11px] text-muted-foreground leading-snug">{intg.reason}</span>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </motion.div>
                      )}

                      {/* Custom Rules — what the agent will be FORCED to do */}
                      {sparkPhase === "ready" && ghostwriterResult && (() => {
                        const rules = extractRulesSection(ghostwriterResult.systemPrompt);
                        return (
                          <motion.div
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.12 }}
                            className="rounded-xl bg-background/60 border border-white/10 p-4 space-y-3"
                            data-testid="spark-custom-rules"
                          >
                            <div className="flex items-center gap-2">
                              <Shield className="w-3.5 h-3.5 text-rose-400" />
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                Custom Rules
                              </p>
                              <span className="ml-auto text-[10px] text-muted-foreground">
                                {rules.length === 0 ? "none yet" : `${rules.length} rule${rules.length === 1 ? "" : "s"}`}
                              </span>
                            </div>
                            {rules.length === 0 ? (
                              <p className="text-xs text-muted-foreground italic leading-relaxed">
                                No custom rules yet. Use the suggestions or the input below to add behaviors the agent <span className="text-rose-300 font-medium">must</span> follow — e.g. <span className="text-foreground/70">"verify identity by email before sharing balances"</span>.
                              </p>
                            ) : (
                              <ol className="space-y-1.5">
                                {rules.map((rule, i) => (
                                  <li
                                    key={i}
                                    className="flex items-start gap-2 text-xs text-foreground/85 leading-snug"
                                    data-testid={`spark-rule-${i}`}
                                  >
                                    <span className="text-rose-400 font-mono shrink-0 mt-0.5">{i + 1}.</span>
                                    <span>{rule}</span>
                                  </li>
                                ))}
                              </ol>
                            )}
                            <button
                              onClick={() => setSparkPromptOpen(o => !o)}
                              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                              data-testid="button-toggle-prompt"
                            >
                              {sparkPromptOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                              {sparkPromptOpen ? "Hide" : "View"} full system prompt
                            </button>
                            {sparkPromptOpen && (
                              <pre className="text-[10px] font-mono whitespace-pre-wrap leading-relaxed bg-background/70 border border-white/8 rounded-lg p-3 max-h-60 overflow-y-auto text-foreground/70" data-testid="spark-system-prompt">
                                {ghostwriterResult.systemPrompt}
                              </pre>
                            )}
                          </motion.div>
                        );
                      })()}

                      {/* What would you like to add next? */}
                      {sparkPhase === "ready" && (
                        <motion.div
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.15 }}
                          className="space-y-3 pt-1"
                        >
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-0.5">
                            What would you like to add next?
                          </p>

                          {/* Suggestion chips */}
                          {sparkSuggestions.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {sparkSuggestions.map((s, i) => (
                                <button
                                  key={i}
                                  onClick={() => handleSparkRefinement(s)}
                                  disabled={sparkRefining || ghostwriterCreating}
                                  data-testid={`spark-suggestion-${i}`}
                                  className="text-xs px-3 py-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 hover:border-violet-400/50 transition-all disabled:opacity-40 text-left"
                                >
                                  {s}
                                </button>
                              ))}
                            </div>
                          )}

                          {/* Custom refinement input */}
                          <div className="flex gap-2">
                            <Input
                              value={sparkCustomInput}
                              onChange={e => setSparkCustomInput(e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSparkRefinement(sparkCustomInput); } }}
                              placeholder="Or type your own request…"
                              className="h-9 text-sm bg-background/60 border-white/10"
                              disabled={sparkRefining || ghostwriterCreating}
                              data-testid="input-spark-custom"
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleSparkRefinement(sparkCustomInput)}
                              disabled={!sparkCustomInput.trim() || sparkRefining || ghostwriterCreating}
                              className="h-9 px-3 border-white/10"
                              data-testid="button-spark-refine"
                            >
                              {sparkRefining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                            </Button>
                          </div>

                          {/* Action buttons */}
                          <div className="flex gap-2 pt-2 border-t border-white/8">
                            <Button
                              size="sm"
                              onClick={applyGhostwriterResult}
                              disabled={ghostwriterCreating || sparkRefining}
                              className="bg-violet-600 hover:bg-violet-500 text-white"
                              data-testid="button-ghostwriter-apply"
                            >
                              {ghostwriterCreating
                                ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> Creating…</>
                                : <><Sparkles className="w-3 h-3 mr-1.5" /> Create Agent</>
                              }
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => { setSparkPhase("input"); setSparkLog([]); setSparkSuggestions([]); setGhostwriterResult(null); }}
                              disabled={ghostwriterCreating || sparkRefining}
                              className="text-muted-foreground"
                              data-testid="button-spark-restart"
                            >
                              <RefreshCw className="w-3 h-3 mr-1.5" /> Start over
                            </Button>
                          </div>
                        </motion.div>
                      )}
                    </motion.div>
                  )}
                </div>
              </motion.div>

              <div className="flex items-center gap-4 mb-6">
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-xs text-muted-foreground uppercase tracking-wider">or choose a demo use case</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>

              <div className="grid md:grid-cols-1 gap-6 mb-8">
                {VOICE_USE_CASES.map((useCase) => (
                  <motion.div
                    key={useCase.id}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                  >
                    <Card
                      className="cursor-pointer border border-cyan-500/25 bg-gradient-to-br from-cyan-500/10 via-blue-500/5 to-purple-500/10 p-6 transition-all hover:border-cyan-300/50"
                      onClick={() => applyUseCase(useCase.id)}
                      data-testid={`use-case-card-${useCase.id}`}
                    >
                      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-200">
                              {useCase.category}
                            </span>
                            <span className="text-xs text-muted-foreground">{useCase.heroMetric}</span>
                          </div>
                          <h3 className="mt-3 text-xl font-semibold">{useCase.title}</h3>
                          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{useCase.description}</p>
                          <div className="mt-4 flex flex-wrap gap-2">
                            {useCase.capabilityChips.map((chip) => (
                              <span key={chip} className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/70">
                                {chip}
                              </span>
                            ))}
                          </div>
                        </div>
                        <Button className="shrink-0 bg-cyan-600 text-white hover:bg-cyan-500">
                          <Workflow className="mr-2 h-4 w-4" />
                          Load Use Case
                        </Button>
                      </div>
                    </Card>
                  </motion.div>
                ))}
              </div>

              <div className="flex items-center gap-4 mb-6">
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-xs text-muted-foreground uppercase tracking-wider">or pick a template</span>
                <div className="h-px flex-1 bg-white/10" />
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
                  onClick={() => {
                    setBuildMode('scratch');
                    setSelectedTemplate(null);
                    setSelectedUseCaseId(null);
                  }}
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
                {selectedUseCaseId && (
                  <span className="text-sm text-muted-foreground">
                    Use case: <span className="text-cyan-300 font-medium">
                      {VOICE_USE_CASES.find(t => t.id === selectedUseCaseId)?.title}
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
              <div className="w-10 h-10 rounded-full bg-cyan-500/10 flex items-center justify-center text-cyan-300">
                <Workflow className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-2xl font-display font-semibold">Use Case</h2>
                <p className="text-muted-foreground text-sm">Load a demo script that sets identity, prompt rules, tools, and UI context.</p>
              </div>
            </div>

            <div className="grid gap-4">
              {VOICE_USE_CASES.map((useCase) => {
                const selected = selectedUseCaseId === useCase.id;
                return (
                  <Card
                    key={useCase.id}
                    className={`p-5 transition-all ${selected ? "border-cyan-300/50 bg-cyan-500/10" : "border-white/10 bg-card/50 hover:border-white/25"}`}
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-cyan-400/10 px-2.5 py-1 text-xs font-medium text-cyan-200">
                            {useCase.category}
                          </span>
                          <span className="text-xs text-muted-foreground">{useCase.heroMetric}</span>
                        </div>
                        <h3 className="mt-3 text-lg font-semibold">{useCase.title}</h3>
                        <p className="mt-2 max-w-4xl text-sm text-muted-foreground">{useCase.demoGoal}</p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          {useCase.capabilityChips.map((chip) => (
                            <span key={chip} className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/70">
                              {chip}
                            </span>
                          ))}
                        </div>
                      </div>
                      <Button
                        variant={selected ? "secondary" : "outline"}
                        className="shrink-0"
                        onClick={() => applyUseCase(useCase.id)}
                        data-testid={`button-apply-use-case-${useCase.id}`}
                      >
                        {selected ? <Check className="mr-2 h-4 w-4" /> : <Workflow className="mr-2 h-4 w-4" />}
                        {selected ? "Applied" : "Apply Use Case"}
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          </motion.section>

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
              {LLMS.map((llm: any) => (
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
                    {VOICES.map((voice: any) => (
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
                  <div className="space-y-5">
                    <div>
                      <p className="text-sm text-muted-foreground mb-4">Add content your agent will reference when answering questions. Sources are injected into the agent's context automatically.</p>

                      <div className="grid grid-cols-3 gap-3 mb-5">
                        <button
                          className="flex flex-col items-center gap-2.5 p-4 rounded-xl border border-white/10 bg-white/3 hover:bg-white/8 hover:border-blue-500/40 transition-all group text-center"
                          onClick={() => { setShowAddUrl(!showAddUrl); setShowAddText(false); }}
                          data-testid="button-add-url"
                        >
                          <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center group-hover:bg-blue-500/20 transition-colors">
                            <Link2 className="w-5 h-5 text-blue-400" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">Add URL</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Fetch a web page</p>
                          </div>
                        </button>

                        <label className="flex flex-col items-center gap-2.5 p-4 rounded-xl border border-white/10 bg-white/3 hover:bg-white/8 hover:border-purple-500/40 transition-all group text-center cursor-pointer" data-testid="label-add-file">
                          <input
                            type="file"
                            accept=".txt,.md,.pdf,.csv"
                            className="hidden"
                            data-testid="input-add-file"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              setKbLoading(true);
                              try {
                                const agentId = await ensureAgentSaved();
                                await knowledgeBaseApi.addFile(agentId, file);
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
                          <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center group-hover:bg-purple-500/20 transition-colors">
                            {kbLoading ? <Loader2 className="w-5 h-5 text-purple-400 animate-spin" /> : <Database className="w-5 h-5 text-purple-400" />}
                          </div>
                          <div>
                            <p className="text-sm font-medium">Upload File</p>
                            <p className="text-xs text-muted-foreground mt-0.5">PDF, TXT, MD, CSV</p>
                          </div>
                        </label>

                        <button
                          className="flex flex-col items-center gap-2.5 p-4 rounded-xl border border-white/10 bg-white/3 hover:bg-white/8 hover:border-green-500/40 transition-all group text-center"
                          onClick={() => { setShowAddText(!showAddText); setShowAddUrl(false); }}
                          data-testid="button-create-text"
                        >
                          <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center group-hover:bg-green-500/20 transition-colors">
                            <FileText className="w-5 h-5 text-green-400" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">Write Text</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Paste or type content</p>
                          </div>
                        </button>
                      </div>

                      {showAddUrl && (
                        <div className="p-4 bg-blue-500/5 rounded-xl border border-blue-500/20 space-y-3 mb-4">
                          <div className="flex items-center gap-2 mb-1">
                            <Link2 className="w-4 h-4 text-blue-400" />
                            <p className="text-sm font-medium">Add URL</p>
                          </div>
                          <Input
                            value={newKbUrl}
                            onChange={(e) => setNewKbUrl(e.target.value)}
                            placeholder="https://example.com/docs/page"
                            className="bg-background border-white/10"
                            data-testid="input-kb-url"
                            onKeyDown={(e) => { if (e.key === 'Enter' && newKbUrl) e.currentTarget.blur(); }}
                          />
                          <p className="text-xs text-muted-foreground">The page will be fetched and its text content saved as a source.</p>
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => { setShowAddUrl(false); setNewKbUrl(""); }}>Cancel</Button>
                            <Button
                              size="sm"
                              disabled={!newKbUrl || kbLoading}
                              data-testid="button-save-url"
                              onClick={async () => {
                                if (!newKbUrl) return;
                                setKbLoading(true);
                                try {
                                  const agentId = await ensureAgentSaved();
                                  await knowledgeBaseApi.addUrl(agentId, newKbUrl);
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
                              {kbLoading ? <><Loader2 className="w-4 h-4 animate-spin mr-1" />Fetching...</> : "Fetch & Save"}
                            </Button>
                          </div>
                        </div>
                      )}

                      {showAddText && (
                        <div className="p-4 bg-green-500/5 rounded-xl border border-green-500/20 space-y-3 mb-4">
                          <div className="flex items-center gap-2 mb-1">
                            <FileText className="w-4 h-4 text-green-400" />
                            <p className="text-sm font-medium">Write Text</p>
                          </div>
                          <Input
                            value={newKbTitle}
                            onChange={(e) => setNewKbTitle(e.target.value)}
                            placeholder="Source title (e.g. Product FAQ)"
                            className="bg-background border-white/10"
                            data-testid="input-kb-text-title"
                          />
                          <Textarea
                            value={newKbContent}
                            onChange={(e) => setNewKbContent(e.target.value)}
                            placeholder="Paste or write the content this agent should know about..."
                            className="bg-background border-white/10 min-h-[140px]"
                            data-testid="input-kb-text-content"
                          />
                          <p className="text-xs text-muted-foreground">{newKbContent.length.toLocaleString()} characters · max 50,000</p>
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => { setShowAddText(false); setNewKbTitle(""); setNewKbContent(""); }}>Cancel</Button>
                            <Button
                              size="sm"
                              disabled={!newKbTitle || !newKbContent || kbLoading}
                              data-testid="button-save-text"
                              onClick={async () => {
                                if (!newKbTitle || !newKbContent) return;
                                setKbLoading(true);
                                try {
                                  const agentId = await ensureAgentSaved();
                                  await knowledgeBaseApi.addText(agentId, newKbTitle, newKbContent);
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
                              {kbLoading ? <><Loader2 className="w-4 h-4 animate-spin mr-1" />Saving...</> : "Save Source"}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>

                    {kbItems.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-2">Added Sources ({kbItems.length})</p>
                        <div className="space-y-2">
                          {kbItems.map((item) => (
                            <KbItemRow
                              key={item.id}
                              item={item}
                              onUpdated={refetchKbItems}
                              onDeleted={refetchKbItems}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {kbItems.length === 0 && !showAddUrl && !showAddText && (
                      <div className="text-center py-8 text-muted-foreground border border-dashed border-white/10 rounded-xl">
                        <Database className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p className="text-sm font-medium">No sources yet</p>
                        <p className="text-xs mt-1 opacity-70">Add a URL, upload a file, or write text above</p>
                      </div>
                    )}

                    {savedAgentId && (
                      <div className="pt-1">
                        <Button
                          className="w-full"
                          onClick={() => setLocation(`/evaluate?agentId=${savedAgentId}`)}
                          data-testid="button-start-evaluating"
                        >
                          Start Evaluating
                        </Button>
                      </div>
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
                          {selectedUseCaseId ? " Loaded from the server tool catalog." : ""}
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
                      {serverUseCaseToolsLoading && selectedUseCaseId && (
                        <div className="flex items-center gap-2 rounded-lg border border-white/5 bg-background/30 p-3 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading server tools...
                        </div>
                      )}
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
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-medium text-sm">{tool.name}</p>
                                {tool.provider && (
                                  <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                                    {tool.provider}
                                  </span>
                                )}
                              </div>
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

                    {webexStats?.hasToken && (webexRooms.length > 0 || webexStats.hasDefaultSpace) && (
                      <div className="p-4 bg-background/30 rounded-lg border border-white/5 space-y-3">
                        <Label className="text-sm font-medium">Quick Send to Webex</Label>
                        {webexRooms.length > 0 && (
                          <Select value={selectedRoomId} onValueChange={setSelectedRoomId}>
                            <SelectTrigger className="w-full bg-background border-white/10" data-testid="select-webex-room">
                              <SelectValue placeholder={webexStats.hasDefaultSpace ? "Use profile space or select one..." : "Select a space..."} />
                            </SelectTrigger>
                            <SelectContent className="max-h-60 overflow-y-auto">
                              {webexRooms.map((room) => (
                                <SelectItem key={room.id} value={room.id} className="truncate">
                                  {room.title}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        
                        {(selectedRoomId || webexStats.hasDefaultSpace) && (
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
              disabled={saveAgentMutation.isPending || !agentName.trim()}
              data-testid="button-create-agent"
             >
               {saveAgentMutation.isPending ? (
                 <>{savedAgentId ? "Saving Agent..." : "Creating Agent..."}</>
               ) : (
                 <>{savedAgentId ? "Save Agent" : "Create Agent"} <Sparkles className="w-4 h-4 ml-2" /></>
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
