import { RETAIL_STORE_ASSISTANT_USE_CASE, DEFAULT_CUSTOMER_NAME } from "@shared/use-cases";

export interface BrowserTranscriptGuardContext {
  browserPlaybackActive: boolean;
  lastAssistantAudioAt: number;
  lastAssistantDoneAt: number;
  lastAssistantTranscript: string;
  responseActive: boolean;
}

export type TwilioMonitorEvent =
  | { type: "connected"; agentId: string }
  | { type: "callStarted"; agentId: string; callSid?: string; streamSid?: string; callerPhone?: string; timestamp: number }
  | { type: "callEnded"; agentId: string; timestamp: number }
  | { type: "smsSent"; agentId: string; to: string; timestamp: number }
  | { type: "toolCallStarted"; agentId: string; toolName: string; args?: Record<string, any>; timestamp: number }
  | { type: "toolCallCompleted"; agentId: string; toolName: string; success: boolean; result?: string; error?: string; data?: unknown; durationMs?: number; timestamp: number }
  | { type: "identityVerificationSent" | "identityVerified" | "customerContextLoaded" | "inventoryUpdated" | "recommendationCreated" | "reservationCreated" | "associateHandoffCreated"; agentId: string; data: unknown; timestamp: number }
  | { type: "userTranscript" | "assistantTranscript"; agentId: string; text: string; rawText?: string; correctedText?: string; corrected?: boolean; timestamp: number };

export interface CallTranscriptEntry {
  role: "Customer" | "Assistant";
  text: string;
  timestamp: number;
}

export interface StoreManagerCallSummary {
  customer_name: string;
  final_resolution: string;
  summary: string;
  customer_intent: string;
  products_discussed: string;
  customer_preferences: string;
  store_actions: string;
  recommended_next_step: string;
  reserved_item: string;
  pickup_time: string;
  recommended_upsell: string;
}

export interface RetailReservationDetails {
  customerName: string;
  itemName: string;
  itemDetails: string;
  store: string;
  pickupTime: string;
  reservationId: string;
}

export interface DemoCustomerProfile {
  name: string;
  firstName: string;
  lastName: string;
  lastInitial: string;
  maskedName: string;
  phone: string;
  customerId: string;
  email: string;
}


const DEFAULT_CUSTOMER_PHONE = RETAIL_STORE_ASSISTANT_USE_CASE.customer.phone;

function getEnvValue(env: NodeJS.ProcessEnv, key: string): string {
  return env[key]?.trim() || "";
}

function splitCustomerName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const defaultParts = DEFAULT_CUSTOMER_NAME.split(/\s+/);
  const firstName = parts[0] || defaultParts[0];
  const lastName = parts.length > 1 ? parts[parts.length - 1] : defaultParts[defaultParts.length - 1];
  return { firstName, lastName };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "customer";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceWord(text: string, source: string, replacement: string): string {
  if (!source) return text;
  return text.replace(new RegExp(`\\b${escapeRegExp(source)}\\b`, "g"), replacement);
}

function replaceDemoIdentityText(text: string, profile: DemoCustomerProfile): string {
  const sourceCustomer = RETAIL_STORE_ASSISTANT_USE_CASE.customer;
  const sourceProfile = getProfileFromNameAndPhone(sourceCustomer.name, sourceCustomer.phone);
  const sourceMaskedName = `${sourceProfile.firstName} ${sourceProfile.lastInitial}.`;
  const sourceExampleName = `${sourceProfile.firstName} Smith`;
  const targetExampleName = `${profile.firstName} ${profile.lastName}`;

  let replaced = text.replace(new RegExp(escapeRegExp(sourceCustomer.phone), "g"), profile.phone);
  replaced = replaceWord(replaced, sourceExampleName, targetExampleName);
  replaced = replaceWord(replaced, sourceCustomer.name, profile.name);
  replaced = replaceWord(replaced, sourceMaskedName, profile.maskedName);
  replaced = replaceWord(replaced, `${sourceProfile.firstName}'s`, `${profile.firstName}'s`);
  replaced = replaceWord(replaced, sourceProfile.firstName, profile.firstName);
  return replaced;
}

function getProfileFromNameAndPhone(name: string, phone: string): DemoCustomerProfile {
  const { firstName, lastName } = splitCustomerName(name);
  const lastInitial = lastName.charAt(0).toUpperCase();
  return {
    name,
    firstName,
    lastName,
    lastInitial,
    maskedName: `${firstName} ${lastInitial}.`,
    phone,
    customerId: `cust-${slugify(firstName)}-042`,
    email: `${slugify(firstName)}.${slugify(lastName)}@example.com`,
  };
}

export function getDemoCustomerProfile(env: NodeJS.ProcessEnv = process.env): DemoCustomerProfile {
  const name = getEnvValue(env, "DEMO_CUSTOMER_NAME") || DEFAULT_CUSTOMER_NAME;
  const phone = getEnvValue(env, "DEMO_CUSTOMER_PHONE") || DEFAULT_CUSTOMER_PHONE;
  return getProfileFromNameAndPhone(name, phone);
}

export function getDemoRetailCustomer(env: NodeJS.ProcessEnv = process.env) {
  const profile = getDemoCustomerProfile(env);
  const customer = RETAIL_STORE_ASSISTANT_USE_CASE.customer;
  return {
    ...customer,
    name: profile.name,
    phone: profile.phone,
    relationshipContext: replaceDemoIdentityText(customer.relationshipContext, profile),
    preferences: customer.preferences.map((preference) => replaceDemoIdentityText(preference, profile)),
    pastChats: customer.pastChats.map((chat) => ({
      ...chat,
      summary: replaceDemoIdentityText(chat.summary, profile),
    })),
  };
}

export function getDemoRetailAssociatePlaybook(env: NodeJS.ProcessEnv = process.env) {
  const profile = getDemoCustomerProfile(env);
  const playbook = RETAIL_STORE_ASSISTANT_USE_CASE.associatePlaybook;
  return {
    ...playbook,
    customerName: profile.name,
    associateMessage: replaceDemoIdentityText(playbook.associateMessage, profile),
  };
}

