import {
  RETAIL_STORE_ASSISTANT_USE_CASE,
  getRetailInventoryStatusLabel,
  type RetailInventoryItem,
} from "@shared/use-cases";
import OpenAI from "openai";

type ToolResult = { success: boolean; result?: string; error?: string; data?: unknown };

const generatedInventory = new Map<string, RetailInventoryItem>();
const RETAIL_DYNAMIC_LOOKUP_TIMEOUT_MS = 3500;

export const retailTools = [
  {
    type: "function" as const,
    name: "retail_user_lookup",
    description:
      "Look up the caller profile at the start of every call. Use this silently before greeting or answering customer-specific questions.",
    parameters: {
      type: "object",
      properties: {
        phone: {
          type: "string",
          description: "Caller phone number in E.164 format when available.",
        },
      },
      required: [],
    },
  },
  {
    type: "function" as const,
    name: "retail_user_history_lookup",
    description:
      "Fetch prior orders, issues, and engagement history for the caller. Use this silently after retail_user_lookup so the agent can use the context later when appropriate.",
    parameters: {
      type: "object",
      properties: {
        customerId: {
          type: "string",
          description: "Customer identifier returned by retail_user_lookup.",
        },
        phone: {
          type: "string",
          description: "Caller phone number in E.164 format when available.",
        },
        conversationLimit: {
          type: "number",
          description: "Maximum number of past conversations to retrieve.",
        },
      },
      required: [],
    },
  },
  {
    type: "function" as const,
    name: "retail_get_customer_context",
    description:
      "Retrieve the customer's profile, preferences, and previous interactions after user lookup.",
    parameters: {
      type: "object",
      properties: {
        customerName: {
          type: "string",
          description: "Optional customer name if the caller supplied one.",
        },
        phone: {
          type: "string",
          description: "Caller phone number in E.164 format when available.",
        },
      },
      required: [],
    },
  },
  {
    type: "function" as const,
    name: "retail_lookup_inventory",
    description:
      "Look up inventory by product or category across the current store and nearby stores.",
    parameters: {
      type: "object",
      properties: {
        product: {
          type: "string",
          description: "Product name, category, or SKU to look up.",
        },
        preferredStore: {
          type: "string",
          description: "Optional preferred store or current location.",
        },
      },
      required: ["product"],
    },
  },
  {
    type: "function" as const,
    name: "retail_reserve_item",
    description:
      "Reserve an available product for the customer at the selected store and caller-confirmed pickup date and pickup time. Do not call until the caller has provided or confirmed both the pickup date/day and a specific pickup time.",
    parameters: {
      type: "object",
      properties: {
        sku: {
          type: "string",
          description: "SKU to reserve. Use the SKU from the inventory lookup when possible.",
        },
        product: {
          type: "string",
          description: "Product name to reserve if SKU is not known.",
        },
        store: {
          type: "string",
          description: "Store where the item should be reserved.",
        },
        pickupTime: {
          type: "string",
          description: "Specific pickup time requested or confirmed by the customer in this call, such as 1 PM or 14:30. Do not include a default time.",
        },
        pickupDate: {
          type: "string",
          description: "Pickup date or day requested or confirmed by the customer in this call, such as Friday or May 15. Do not include a default date.",
        },
        customerName: {
          type: "string",
          description: "Customer name for the reservation.",
        },
        phone: {
          type: "string",
          description: "Customer phone number in E.164 format.",
        },
      },
      required: ["store", "pickupDate", "pickupTime"],
    },
  },
  {
    type: "function" as const,
    name: "retail_recommend_accessory",
    description:
      "Recommend a personalized accessory based on customer memory and selected product.",
    parameters: {
      type: "object",
      properties: {
        product: {
          type: "string",
          description: "Reserved or selected product. Prefer the exact product from the reservation result.",
        },
        originalRequest: {
          type: "string",
          description: "Optional original item the customer asked for before substitutions or nearby alternatives.",
        },
        store: {
          type: "string",
          description: "Optional store where the primary product is being reserved.",
        },
        recentConversationSummary: {
          type: "string",
          description: "Brief summary of what the customer said in this call that may help personalize the recommendation.",
        },
        customerName: {
          type: "string",
          description: "Customer name.",
        },
        phone: {
          type: "string",
          description: "Customer phone number in E.164 format.",
        },
      },
      required: ["product"],
    },
  },
];

export async function user_lookup(args: Record<string, any>): Promise<ToolResult> {
  const suppliedPhone = typeof args.phone === "string" ? args.phone.trim() : "";
  const customer = RETAIL_STORE_ASSISTANT_USE_CASE.customer;

  return {
    success: true,
    result: `User lookup complete: John found as a returning Gold member.`,
    data: {
      customerId: "cust-john-042",
      name: "John",
      fullName: "John Rivera",
      preferredName: "John",
      phone: suppliedPhone ? maskPhone(suppliedPhone) : maskPhone(customer.phone),
      email: "john.rivera@example.com",
      loyaltyTier: "Gold member",
      preferredStore: "San Jose",
      preferredPickupWindow: customer.preferredPickupTime,
      consent: {
        sms: true,
        personalization: true,
      },
      accountSignals: {
        returningCustomer: true,
        lifetimeOrders: 14,
        lastSeen: "May 10",
      },
    },
  };
}

export async function user_history_lookup(args: Record<string, any>): Promise<ToolResult> {
  const conversationLimit = Number.isFinite(Number(args.conversationLimit))
    ? Math.max(1, Math.min(500, Math.floor(Number(args.conversationLimit))))
    : 500;

  return {
    success: true,
    result: `Fetched ${conversationLimit} past conversations, previous orders, open issues, transactions, and engagement signals for John. Context source: prior Webex/SMS conversations, order history, transaction activity, store visits, and browsing engagement.`,
    data: {
      customerId: String(args.customerId || "cust-john-042"),
      conversationCount: conversationLimit,
      contextSources: [
        "Past Webex conversations",
        "SMS conversations",
        "Previous orders",
        "Transaction activity",
        "Open and resolved issues",
        "Store visit notes",
        "Product browsing engagement",
      ],
      previousOrder: {
        orderId: "ORD-88421",
        date: "May 3",
        item: "iPad Pro 11-inch, 256GB, Blue",
        status: "Not purchased yet; customer compared pickup options",
      },
      previousIssues: [
        {
          date: "May 6",
          channel: "Webex",
          summary: "Asked whether the tablet supported parental controls and durable kid-friendly cases.",
          status: "Resolved",
        },
        {
          date: "May 9",
          channel: "SMS",
          summary: "Checked purple case availability and asked about same-day pickup.",
          status: "Open buying journey",
        },
      ],
      engagements: [
        "Viewed iPad product pages three times this week",
        "Clicked pickup availability for San Jose and Palo Alto",
        "Previously responded well to concise SMS follow-up",
      ],
      timelineSummary:
        "Combined 500 past conversations with order history, transactions, issue records, store visit notes, and browsing engagement.",
      usableLaterContext:
        "Use this context only when it helps the current conversation. Do not announce the internal lookup.",
    },
  };
}

export async function get_customer_context(args: Record<string, any>): Promise<ToolResult> {
  const customer = RETAIL_STORE_ASSISTANT_USE_CASE.customer;
  const suppliedName = typeof args.customerName === "string" ? args.customerName.trim() : "";
  const suppliedPhone = typeof args.phone === "string" ? args.phone.trim() : "";

  return {
    success: true,
    result: `Loaded ${customer.name} (${customer.loyaltyTier}). ${customer.intent}`,
    data: {
      confidence: "user-lookup",
      verification: {
        phone: suppliedPhone ? maskPhone(suppliedPhone) : maskPhone(customer.phone),
        method: "lookup",
        verified: true,
        verifiedAt: Date.now(),
      },
      customer,
      pastChats: customer.pastChats,
      suppliedName,
    },
  };
}

export async function lookup_inventory(args: Record<string, any>): Promise<ToolResult> {
  const product = String(args.product || "").trim();
  const query = product.toLowerCase();
  const preferredStore = String(args.preferredStore || "").trim();
  if (!query) {
    return { success: false, error: "Product is required for inventory lookup" };
  }

  const dynamicLookup = await generateInventoryLookup({ product, preferredStore });
  if (dynamicLookup) {
    dynamicLookup.items.forEach((item) => generatedInventory.set(item.sku, item));

    return {
      success: true,
      result: [
        dynamicLookup.unavailable[0]
          ? `${dynamicLookup.unavailable[0].name} is out of stock at ${dynamicLookup.unavailable[0].store}.`
          : null,
        dynamicLookup.recommendation
          ? `${dynamicLookup.recommendation.name} is ${getRetailInventoryStatusLabel(dynamicLookup.recommendation.status).toLowerCase()} at ${dynamicLookup.recommendation.store}.`
          : null,
      ]
        .filter(Boolean)
        .join(" "),
      data: {
        query,
        items: dynamicLookup.items,
        available: dynamicLookup.available,
        unavailable: dynamicLookup.unavailable,
        recommendation: dynamicLookup.recommendation,
        generatedBy: dynamicLookup.generatedBy,
      },
    };
  }

  return {
    success: true,
    result: `${product} is not showing as available in the current inventory right now. Similar products, nearby availability, or a back-in-stock notification may still be possible.`,
    data: {
      query,
      items: [],
      available: [],
      unavailable: [],
      recommendation: null,
      noMatch: true,
    },
  };
}

function hasPickupDateSignal(value: string): boolean {
  const text = value.toLowerCase();
  return (
    /\b(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/.test(text) ||
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b\s+\d{1,2}\b/.test(text) ||
    /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/.test(text)
  );
}

function hasPickupTimeSignal(value: string): boolean {
  const text = value.toLowerCase();
  return (
    /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/.test(text) ||
    /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/.test(text) ||
    /\b(noon|midday|midnight)\b/.test(text)
  );
}

function extractPickupDateFromCombined(value: string): string {
  const text = value.trim();
  const match =
    text.match(/\b(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i) ||
    text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b\s+\d{1,2}\b/i) ||
    text.match(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/);
  return match?.[0] || "";
}

function extractPickupTimeFromCombined(value: string): string {
  const text = value.trim();
  const match =
    text.match(/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/i) ||
    text.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/) ||
    text.match(/\b(noon|midday|midnight)\b/i);
  return match?.[0] || "";
}

export async function reserve_item(args: Record<string, any>): Promise<ToolResult> {
  const store = String(args.store || RETAIL_STORE_ASSISTANT_USE_CASE.associatePlaybook.reservedStore).trim();
  const rawPickupDate = String(args.pickupDate || "").trim();
  const rawPickupTime = String(args.pickupTime || "").trim();
  const combinedPickup = [rawPickupDate, rawPickupTime].filter(Boolean).join(" ").trim();
  const hasPickupDate = hasPickupDateSignal(combinedPickup);
  const hasPickupTime = hasPickupTimeSignal(combinedPickup);
  const pickupDate = rawPickupDate && hasPickupDateSignal(rawPickupDate)
    ? rawPickupDate
    : extractPickupDateFromCombined(combinedPickup);
  const pickupClockTime = rawPickupTime && hasPickupTimeSignal(rawPickupTime)
    ? rawPickupTime
    : extractPickupTimeFromCombined(combinedPickup);
  const pickupTime = [pickupDate, pickupClockTime].filter(Boolean).join(" at ").trim() || combinedPickup;
  const product = String(args.product || args.sku || RETAIL_STORE_ASSISTANT_USE_CASE.associatePlaybook.reservedItem).trim();
  const customerName = String(args.customerName || RETAIL_STORE_ASSISTANT_USE_CASE.customer.name).trim();

  if (!hasPickupDate || !hasPickupTime) {
    const missing = !hasPickupDate && !hasPickupTime
      ? "pickup date and pickup time"
      : !hasPickupDate
        ? "pickup date"
        : "pickup time";
    return {
      success: false,
      error: `Ask the caller for their preferred ${missing} before creating the reservation.`,
      data: {
        product,
        store,
        customerName,
        pickupDate: rawPickupDate,
        pickupTime: rawPickupTime,
        pickupDateRequired: !hasPickupDate,
        pickupTimeRequired: !hasPickupTime,
      },
    };
  }

  const item = findInventoryItem(product, store);
  if (!item || item.status === "out_of_stock" || item.quantity <= 0) {
    return {
      success: false,
      error: `${product || "That item"} is not available for reservation at ${store}.`,
      data: { product, store, pickupDate, pickupTime, customerName },
    };
  }

  const reservation = {
    reservationId: "RSV-430-JOHN",
    customerName,
    item,
    store,
    pickupDate,
    pickupTime,
    status: "confirmed",
  };
  return {
    success: true,
    result: `${item.name} is reserved for ${customerName} at ${store} for ${pickupTime}. Reservation RSV-430-JOHN.`,
    data: reservation,
  };
}

export async function recommend_accessory(args: Record<string, any>): Promise<ToolResult> {
  const product = String(args.product || "").trim();
  const originalRequest = String(args.originalRequest || "").trim();
  const store = String(args.store || "").trim();
  const recentConversationSummary = String(args.recentConversationSummary || "").trim();
  const recommendation = await generateAccessoryRecommendation({
    product,
    originalRequest,
    store,
    recentConversationSummary,
  });
  const accessory = recommendation?.item;
  if (accessory) generatedInventory.set(accessory.sku, accessory);

  return {
    success: true,
    result: accessory
      ? `Recommended add-on: ${accessory.name}. ${recommendation.reason}`
      : "No accessory recommendation is available for this product from the current accessory inventory.",
    data: {
      product,
      originalRequest,
      store,
      recentConversationSummary,
      recommendation: accessory,
      rationale: recommendation?.reason || "No compatible accessory was selected from the current accessory inventory.",
      rationaleSource: recommendation?.source || "none",
      personalizationSignal: recommendation?.personalizationSignal || "",
      suggestedWording: recommendation?.suggestedWording || "",
      generatedBy: recommendation?.generatedBy || "none",
    },
  };
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

function maskPhone(phone: string): string {
  const digits = normalizePhone(phone);
  if (digits.length < 4) return "";
  return `***-***-${digits.slice(-4)}`;
}

interface InventoryLookupInput {
  product: string;
  preferredStore: string;
}

interface InventoryLookupResult {
  items: RetailInventoryItem[];
  available: RetailInventoryItem[];
  unavailable: RetailInventoryItem[];
  recommendation: RetailInventoryItem | null;
  generatedBy: string;
}

async function generateInventoryLookup(input: InventoryLookupInput): Promise<InventoryLookupResult | null> {
  if (!process.env.OPENAI_API_KEY || !input.product) {
    return null;
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.RETAIL_INVENTORY_MODEL || "gpt-4o-mini";
  const preferredStore = /palo alto/i.test(input.preferredStore) ? "Palo Alto" : "San Jose";
  const alternateStore = preferredStore === "San Jose" ? "Palo Alto" : "San Jose";

  try {
    const completion = await withTimeout(client.chat.completions.create({
      model,
      temperature: 0.35,
      max_tokens: 520,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Generate realistic consumer electronics inventory for a voice retail agent. Return strict JSON only. Use real product naming when the customer asks for a known product family. Do not use fictional demo brands such as AeroTab, NovaBook, PulseWatch, Orbit Phone, PageLite, SonicWave, PlayBox, HomeMesh, EchoNest, ViewMax, SkyLite, or VistaCam. Every lookup must be tied to San Jose and Palo Alto only. One store must be out_of_stock and the other must be in_stock.",
        },
        {
          role: "user",
          content: JSON.stringify({
            customerRequest: input.product,
            preferredStore,
            alternateStore,
            rule:
              "If a preferred store is supplied, make the requested item out_of_stock there and in_stock at the alternate store. If the request is vague, choose a natural current consumer electronics product that matches the request.",
            requiredJsonShape: {
              requestedProduct: {
                sku: "short uppercase SKU",
                name: "specific product name",
                category: "Tablet | Phone | Smartwatch | Laptop | Headphones | Camera | Gaming Console | Networking | Smart Home | Monitor | E-Reader | Accessory",
                price: "USD price like $799",
                unavailableStore: preferredStore,
                availableStore: alternateStore,
                availableQuantity: "integer from 1 to 8",
                eta: "short restock ETA",
                unavailableNote: "short store-safe note",
                availableNote: "short store-safe note",
              },
              alternatives: [
                {
                  sku: "optional similar product SKU",
                  name: "optional similar product name",
                  category: "same broad category",
                  price: "USD price",
                  unavailableStore: alternateStore,
                  availableStore: preferredStore,
                  availableQuantity: "integer from 1 to 8",
                  eta: "short restock ETA",
                  unavailableNote: "short note",
                  availableNote: "short note",
                },
              ],
            },
          }),
        },
      ],
    }), RETAIL_DYNAMIC_LOOKUP_TIMEOUT_MS, `Dynamic inventory lookup timed out after ${RETAIL_DYNAMIC_LOOKUP_TIMEOUT_MS}ms`);

    const raw = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);
    const products = [parsed.requestedProduct, ...(Array.isArray(parsed.alternatives) ? parsed.alternatives.slice(0, 1) : [])]
      .filter(Boolean)
      .flatMap((item) => buildInventoryPairFromGeneratedItem(item));
    const items = products.filter((item) => !hasDemoBrand(item.name));
    const available = items.filter((item) => item.status !== "out_of_stock" && item.quantity > 0);
    const unavailable = items.filter((item) => item.status === "out_of_stock" || item.quantity <= 0);
    const recommendation = available[0] || null;

    if (!items.length || !recommendation) return null;

    return {
      items,
      available,
      unavailable,
      recommendation,
      generatedBy: `openai:${model}`,
    };
  } catch (error: any) {
    console.error("Dynamic inventory lookup failed:", error?.message || error);
    return null;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function buildInventoryPairFromGeneratedItem(item: any): RetailInventoryItem[] {
  const sku = sanitizeSku(item?.sku || item?.name || "ITEM");
  const name = sanitizeGeneratedText(item?.name || "Requested product");
  const category = sanitizeGeneratedText(item?.category || "Consumer Electronics");
  const price = sanitizeGeneratedText(item?.price || "$499");
  const unavailableStore = /palo alto/i.test(String(item?.unavailableStore)) ? "Palo Alto" : "San Jose";
  const availableStore = unavailableStore === "San Jose" ? "Palo Alto" : "San Jose";
  const quantity = Math.max(1, Math.min(8, Math.floor(Number(item?.availableQuantity) || 3)));

  return [
    {
      sku,
      name,
      category,
      store: unavailableStore,
      status: "out_of_stock",
      quantity: 0,
      price,
      eta: sanitizeGeneratedText(item?.eta || "Back in 3-5 days"),
      note: sanitizeGeneratedText(item?.unavailableNote || `${unavailableStore} is temporarily out of stock.`),
    },
    {
      sku,
      name,
      category,
      store: availableStore,
      status: "in_stock",
      quantity,
      price,
      note: sanitizeGeneratedText(item?.availableNote || `Available for pickup at ${availableStore}.`),
    },
  ];
}

function sanitizeSku(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "ITEM";
}

function sanitizeGeneratedText(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function hasDemoBrand(value: string): boolean {
  return /\b(aerotab|novabook|pulsewatch|orbit phone|pagelite|sonicwave|playbox|homemesh|echonest|viewmax|skylite|vistacam)\b/i.test(value);
}

interface AccessoryRecommendationInput {
  product: string;
  originalRequest: string;
  store: string;
  recentConversationSummary: string;
}

interface AccessoryRecommendation {
  item: RetailInventoryItem;
  reason: string;
  source: string;
  personalizationSignal: string;
  suggestedWording: string;
  generatedBy: string;
}

async function generateAccessoryRecommendation(
  input: AccessoryRecommendationInput
): Promise<AccessoryRecommendation | null> {
  if (!process.env.OPENAI_API_KEY || !input.product) {
    return null;
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.RETAIL_RECOMMENDATION_MODEL || "gpt-4o-mini";
  const customer = RETAIL_STORE_ASSISTANT_USE_CASE.customer;

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.55,
      max_tokens: 520,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Generate one personalized accessory recommendation for a real-time consumer electronics retail agent. Return strict JSON only. Use real accessory naming compatible with the reserved product. Personalize primarily from the current call and reservation context. You may synthesize a plausible past shopping signal from the current request, but do not repeatedly use static profile facts. Do not mention a daughter, birthday, purple preference, or gift context unless the currentConversation or originalCustomerRequest explicitly mentions it. Do not use fictional demo brands such as AeroTab, NovaBook, PulseWatch, Orbit Phone, PageLite, SonicWave, PlayBox, HomeMesh, EchoNest, ViewMax, SkyLite, or VistaCam. If no natural personalized accessory exists, return name as an empty string.",
        },
        {
          role: "user",
          content: JSON.stringify({
            reservedProduct: input.product,
            originalCustomerRequest: input.originalRequest || null,
            reservationStore: input.store || null,
            currentConversation: input.recentConversationSummary || null,
            customerMemory: {
              name: customer.name,
              loyaltyTier: customer.loyaltyTier,
              preferredPickupTime: customer.preferredPickupTime,
              relationshipContext: customer.relationshipContext,
              synthesizedHistorySignals: [
                "Prior conversations can be summarized as practical shopping behavior, not a fixed gift preference.",
                "Order activity suggests John prefers add-ons that make same-day pickup complete.",
                "Store visit notes say John values quick handoff at the counter once a pickup time is selected.",
                "Past SMS engagement shows John responds well to concise, useful add-on suggestions.",
              ],
            },
            requiredJsonShape: {
              sku: "short uppercase accessory SKU",
              name: "specific accessory product name, or empty string",
              price: "USD price like $49",
              quantity: "integer from 1 to 8",
              reason: "one concise reason that combines product fit with a current-call detail, pickup behavior, or plausible prior shopping pattern",
              source: "current conversation plus product fit | pickup behavior plus product fit | order history plus product fit | synthesized shopping pattern plus product fit | none",
              personalizationSignal: "the specific current-call detail or synthesized shopping pattern used, phrased safely for internal display",
              suggestedWording:
                "one short natural sentence the assistant can say. It should briefly say why this is personal, without sounding invasive. If original request differs from reserved product, start with 'For the [reserved product] we reserved...' and do not imply the accessory fits the original requested product.",
            },
          }),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);
    const name = sanitizeGeneratedText(parsed.name || "");
    if (!name || hasDemoBrand(name)) return null;

    const store = /san jose|palo alto/i.test(input.store) ? input.store : "Palo Alto";
    const item: RetailInventoryItem = {
      sku: sanitizeSku(parsed.sku || name),
      name,
      category: "Accessory",
      store,
      status: "in_stock",
      quantity: Math.max(1, Math.min(8, Math.floor(Number(parsed.quantity) || 3))),
      price: sanitizeGeneratedText(parsed.price || "$49"),
      note: "Dynamically recommended accessory for the reserved product.",
    };

    return {
      item,
      reason: normalizeRecommendationReason(String(parsed.reason || `it pairs with ${input.product}`)),
      source: String(parsed.source || "customer history plus product fit").trim(),
      personalizationSignal: normalizeRecommendationSentence(
        String(parsed.personalizationSignal || "Personalized from customer history and current reservation context")
      ),
      suggestedWording: normalizeRecommendationSentence(
        String(parsed.suggestedWording || `This pairs well with the ${input.product}. Want me to add it?`)
      ),
      generatedBy: `openai:${model}`,
    };
  } catch (error: any) {
    console.error("Dynamic accessory recommendation failed:", error?.message || error);
    return null;
  }
}

function normalizeRecommendationSentence(text: string): string {
  return text.trim().replace(/\s+/g, " ").replace(/[.。]+$/g, "");
}

function normalizeRecommendationReason(text: string): string {
  const normalized = normalizeRecommendationSentence(text);
  return normalized ? normalized.charAt(0).toLowerCase() + normalized.slice(1) : normalized;
}

function findInventoryItem(productOrSku: string, store: string): RetailInventoryItem | undefined {
  const query = productOrSku.toLowerCase();
  const normalizedStore = store.toLowerCase();
  return [...generatedInventory.values(), ...RETAIL_STORE_ASSISTANT_USE_CASE.inventory].find((item) => {
    const matchesProduct =
      item.sku.toLowerCase() === query ||
      item.name.toLowerCase().includes(query) ||
      query.includes(item.name.toLowerCase()) ||
      query.includes(item.category.toLowerCase());
    return matchesProduct && item.store.toLowerCase().includes(normalizedStore);
  });
}

function findAvailableInventoryItemBySku(sku: string): RetailInventoryItem | undefined {
  return [...generatedInventory.values(), ...RETAIL_STORE_ASSISTANT_USE_CASE.inventory].find(
    (item) => item.sku === sku && item.status !== "out_of_stock" && item.quantity > 0
  );
}
