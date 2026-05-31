import {
  RETAIL_STORE_ASSISTANT_USE_CASE,
  DEFAULT_STORE,
  getAccessoryForProduct,
  type RetailInventoryItem,
} from "@shared/use-cases";
import OpenAI from "openai";

type ToolResult = { success: boolean; result?: string; error?: string; data?: unknown };

const ENABLE_RETAIL_TIMEOUT = process.env.ENABLE_RETAIL_TIMEOUT === "true";
const RETAIL_DYNAMIC_LOOKUP_TIMEOUT_MS = ENABLE_RETAIL_TIMEOUT ? 3500 : 0;

export const retailTools = [
  {
    type: "function" as const,
    name: "retail_profile_lookup",
    description:
      "Look up a lightweight caller profile candidate by phone number. This does not verify identity. After this tool, ask the caller to confirm their last name before using customer-specific details.",
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
    name: "retail_confirm_profile",
    description:
      "Verify that the caller matches the profile candidate by checking the last name they provide. Call this after retail_profile_lookup and before loading profile history or greeting by customer name.",
    parameters: {
      type: "object",
      properties: {
        customerId: {
          type: "string",
          description: "Customer identifier returned by retail_profile_lookup.",
        },
        lastName: {
          type: "string",
          description: "Last name provided by the caller.",
        },
      },
      required: ["lastName"],
    },
  },
  {
    type: "function" as const,
    name: "retail_user_lookup",
    description:
      "Look up the verified caller profile after identity is confirmed. Do not use this to skip last-name confirmation at call start.",
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
    name: "retail_search_products",
    description:
      "Search the product catalog when the caller asks for a particular product or product family. Use this before discussing availability, alternatives, or inventory for a specific product.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Product name, category, family, or model the caller asked about.",
        },
      },
      required: ["query"],
    },
  },
  {
    type: "function" as const,
    name: "retail_lookup_inventory",
    description:
      "Look up inventory by product or category across all stores. Call this immediately after the customer selects a product — do not ask for a store first. Use 'Palo Alto' as the default preferredStore. If the item is available there, present that store and a suggested pickup time in one turn. Only ask about store preference if the customer wants a different location.",
    parameters: {
      type: "object",
      properties: {
        product: {
          type: "string",
          description: "Product name, category, or SKU to look up.",
        },
        preferredStore: {
          type: "string",
          description: "Preferred pickup store. Default to 'Palo Alto' unless the customer has specified otherwise.",
        },
      },
      required: ["product", "preferredStore"],
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
      required: ["product", "store", "pickupDate", "pickupTime"],
    },
  },
  {
    type: "function" as const,
    name: "retail_recommend_gift_accessory",
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

export async function profile_lookup(_args: Record<string, any>): Promise<ToolResult> {
  return {
    success: true,
    result: "Profile candidate found for Mayada. Ask the caller to confirm their last name before proceeding.",
    data: { customerId: "cust-mayada-042", preferredName: "Mayada", confirmationRequired: true },
  };
}

export async function confirm_profile(args: Record<string, any>): Promise<ToolResult> {
  const suppliedLastName = String(args.lastName || "").trim();
  if (!suppliedLastName) {
    return {
      success: true,
      result: "Last name is required to confirm the profile.",
      data: { verified: false },
    };
  }
  return {
    success: true,
    result: "Profile confirmed. The caller is Mayada Abdelrahman.",
    data: { verified: true, customerId: "cust-mayada-042", preferredName: "Mayada" },
  };
}

export async function user_lookup(_args: Record<string, any>): Promise<ToolResult> {
  return {
    success: true,
    result: "Mayada Abdelrahman — returning Gold member. SMS consent on file.",
    data: { customerId: "cust-mayada-042", name: "Mayada", loyaltyTier: "Gold" },
  };
}

export async function user_history_lookup(args: Record<string, any>): Promise<ToolResult> {
  return {
    success: true,
    result: `History loaded for Mayada. Key context: customer mentioned this purchase is a birthday gift for her daughter. Use this only when relevant — do not announce it.`,
    data: {
      customerId: String(args.customerId || "cust-mayada-042"),
      keyContext: "Customer is buying a birthday gift for her daughter.",
      usableLaterContext: "Use this context only when it helps the current conversation. Do not announce the internal lookup.",
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

export async function search_products(args: Record<string, any>): Promise<ToolResult> {
  const query = String(args.query || args.product || "").trim();
  if (!query) {
    return { success: false, error: "Product search query is required." };
  }

  const queryLower = query.toLowerCase();
  const queryWords = getProductQueryWords(queryLower);
  const matches = RETAIL_STORE_ASSISTANT_USE_CASE.inventory
    .filter((item) => item.category.toLowerCase() !== "accessory")
    .filter((item) => productMatchesQuery(item, queryLower, queryWords))
    .slice(0, 6);
  const catalogMatches = getUniqueCatalogProducts(matches);

  if (catalogMatches.length === 0) {
    return {
      success: true,
      result: `No exact catalog match found for ${query}. Ask one clarifying question or offer to check nearby alternatives.`,
      data: {
        query,
        matches: [],
        noMatch: true,
      },
    };
  }

  const topMatch = catalogMatches[0];
  const availableMatch = matches.find((item) => item.status === "in_stock" && item.quantity > 0);
  const defaultStore = availableMatch?.store || "Palo Alto";
  return {
    success: true,
    result: `Found ${catalogMatches.length} catalog match${catalogMatches.length === 1 ? "" : "es"} for ${query}: ${catalogMatches.map((item) => item.name).join("; ")}. Do NOT speak to the customer yet. Call retail_lookup_inventory immediately with preferredStore='${defaultStore}' — then respond to the customer with availability, price, and pickup suggestion in one turn.`,
    data: {
      query,
      matches: catalogMatches,
      topMatch,
      availabilityChecked: false,
    },
  };
}

export async function lookup_inventory(args: Record<string, any>): Promise<ToolResult> {
  const product = String(args.product || "").trim();
  const query = product.toLowerCase();
  const preferredStore = String(args.preferredStore || DEFAULT_STORE).trim();
  if (!query) {
    return { success: false, error: "Product is required for inventory lookup" };
  }

  const queryWords = getProductQueryWords(query);
  const items = RETAIL_STORE_ASSISTANT_USE_CASE.inventory.filter(
    (item) => item.category.toLowerCase() !== "accessory" && productMatchesQuery(item, query, queryWords)
  );

  if (items.length === 0) {
    return {
      success: false,
      error: `${product} was not found in the current store catalog. Let the customer know and offer to check a different product.`,
      data: { query },
    };
  }

  const normalizedPreferredStore = preferredStore.toLowerCase().includes(DEFAULT_STORE.toLowerCase())
    ? DEFAULT_STORE
    : preferredStore;

  const available = items.filter((item) => item.status !== "out_of_stock" && item.quantity > 0);
  const preferredAvailable = available.find((item) => item.store === normalizedPreferredStore);
  const recommendation = preferredAvailable || available[0] || null;

  if (!recommendation) {
    const outOfStock = items[0];
    return {
      success: true,
      result: `${outOfStock.name} is currently out of stock. Offer to check an alternative product.`,
      data: { query, recommendation: null, available: [], unavailable: items },
    };
  }

  const atPreferred = recommendation.store === normalizedPreferredStore;
  const storeNote = atPreferred ? "" : ` (nearest available store — ${normalizedPreferredStore} is out of stock)`;
  const priceNote = recommendation.price ? ` Price: ${recommendation.price}.` : "";
  const result = `${recommendation.name} is in stock at ${recommendation.store}${storeNote}.${priceNote} SKU: ${recommendation.sku}. Tell the customer the product name and price, then suggest a pickup day and time in one turn. Call retail_reserve_item once they confirm.`;

  return {
    success: true,
    result,
    data: { query, recommendation, available, unavailable: items.filter((i) => !available.includes(i)) },
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

function getProductQueryWords(query: string): string[] {
  return query
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !/^(\d+(st|nd|rd|th|gb|tb|mm|inch)?|generation|model|new|the|and|for|with)$/.test(w));
}

function productMatchesQuery(item: RetailInventoryItem, queryLower: string, queryWords: string[]): boolean {
  const nameLower = item.name.toLowerCase();
  const skuLower = item.sku.toLowerCase();
  const catLower = item.category.toLowerCase();

  const fastPathRegex = new RegExp(`\\b${queryLower.replace(/[^a-z0-9\s]/g, " ").trim().replace(/\s+/g, "\\b.*\\b")}\\b`);
  if (nameLower.includes(queryLower) || fastPathRegex.test(catLower) || skuLower.includes(queryLower) || queryLower.includes(nameLower)) {
    return true;
  }

  if (queryWords.length >= 2) {
    const significantMatches = queryWords.filter((w) => {
      const regex = new RegExp(`\\b${w}\\b`);
      return regex.test(nameLower) || regex.test(skuLower) || regex.test(catLower);
    });
    return significantMatches.length >= Math.min(2, queryWords.length);
  }

  return queryWords.length === 1 && (new RegExp(`\\b${queryWords[0]}\\b`).test(nameLower) || new RegExp(`\\b${queryWords[0]}\\b`).test(skuLower));
}

function getUniqueCatalogProducts(items: RetailInventoryItem[]): Array<{
  sku: string;
  name: string;
  category: string;
  price: string;
}> {
  const products = new Map<string, {
    sku: string;
    name: string;
    category: string;
    price: string;
  }>();

  items.forEach((item) => {
    const key = `${item.name.toLowerCase()}|${item.category.toLowerCase()}|${item.price.toLowerCase()}`;
    if (!products.has(key)) {
      products.set(key, {
        sku: item.sku,
        name: item.name,
        category: item.category,
        price: item.price,
      });
    }
  });

  return Array.from(products.values());
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
  // If rawPickupTime contains a date signal, extract just the clock portion to avoid "tomorrow at tomorrow at 2pm"
  const pickupClockTime = rawPickupTime && hasPickupTimeSignal(rawPickupTime)
    ? (hasPickupDateSignal(rawPickupTime) ? extractPickupTimeFromCombined(rawPickupTime) || rawPickupTime : rawPickupTime)
    : extractPickupTimeFromCombined(combinedPickup);
  const pickupTime = [pickupDate, pickupClockTime].filter(Boolean).join(" at ").trim() || combinedPickup;
  const product = String(args.product || args.sku || "").trim();
  const customerName = String(args.customerName || RETAIL_STORE_ASSISTANT_USE_CASE.customer.name).trim();

  if (!product) {
    return {
      success: false,
      error: "You must specify the product to reserve.",
      data: { store, pickupDate, pickupTime, customerName },
    };
  }

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

  const item = findInventoryItem(product);
  if (!item || item.status === "out_of_stock" || item.quantity <= 0) {
    return {
      success: false,
      error: `${product || "That item"} is not available for reservation at ${store}.`,
      data: { product, store, pickupDate, pickupTime, customerName },
    };
  }

  const reservation = {
    reservationId: "RSV-430-MAYADA",
    customerName,
    item,
    store,
    pickupDate,
    pickupTime,
    status: "confirmed",
    confirmationDelivery: {
      channel: "customer",
      status: "will_send_after_call",
      message: `Customer confirmation will be handled after the call. Reservation reference RSV-430-MAYADA.`,
    },
  };
  return {
    success: true,
    result: `${item.name} is reserved for ${customerName} at ${store} for ${pickupTime}. Customer confirmation will be handled after the call. Reservation reference RSV-430-MAYADA.`,
    data: reservation,
  };
}

export async function recommend_gift_accessory(args: Record<string, any>): Promise<ToolResult> {
  const product = String(args.product || "").trim();
  const originalRequest = String(args.originalRequest || "").trim();
  const store = String(args.store || "").trim();
  const recentConversationSummary = String(args.recentConversationSummary || "").trim();

  const pairedAccessory = getAccessoryForProduct(product, RETAIL_STORE_ASSISTANT_USE_CASE.inventory);
  if (!pairedAccessory) {
    console.log(`[retail_recommend_gift_accessory] No paired accessory found for product: "${product}"`);
  }

  let recommendation: AccessoryRecommendation | null = null;
  if (pairedAccessory) {
    const suggestedWording = `In our previous conversations you mentioned this is a birthday gift for your daughter — I think a ${pairedAccessory.name} would be a great addition, would you like me to add that?`;
    recommendation = {
      item: pairedAccessory,
      reason: "it is a compatible accessory for the reserved product and the customer mentioned this is a birthday gift for their daughter",
      source: "customer history plus product fit",
      personalizationSignal: "Customer previously mentioned the purchase is a birthday gift for their daughter.",
      suggestedWording,
      generatedBy: "static-catalog",
    };
  }

  const accessory = recommendation?.item;

  return {
    success: true,
    result: accessory
      ? `Retrieving from long term memory. Looking at past conversations: Recommend ${accessory.name} because ${recommendation?.reason}. Source: ${recommendation?.source}. Suggested wording: ${recommendation?.suggestedWording}`
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

function shouldLogRetailOpenAi(): boolean {
  return process.env.LOG_RETAIL_OPENAI_PROMPTS === "true" || process.env.NODE_ENV !== "production";
}

const inventoryLookupCache = new Map<string, InventoryLookupResult>();

async function generateInventoryLookup(input: InventoryLookupInput): Promise<InventoryLookupResult | null> {
  const cacheKey = `${input.product.toLowerCase()}:${input.preferredStore.toLowerCase()}`;
  if (inventoryLookupCache.has(cacheKey)) {
    console.log(`[Retail/OpenAI][inventory] Cache hit for "${cacheKey}"`);
    return inventoryLookupCache.get(cacheKey)!;
  }
  if (!process.env.OPENAI_API_KEY || !input.product) {
    return null;
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.RETAIL_INVENTORY_MODEL || "gpt-4o-mini";
  const preferredStore = /palo alto/i.test(input.preferredStore) ? "Palo Alto" : "San Jose";
  const alternateStore = preferredStore === "San Jose" ? "Palo Alto" : "San Jose";
  const messages = [
    {
      role: "system" as const,
      content:
        "Retail inventory assistant. Return JSON only. Use real product names. No fictional brands. Stores: San Jose and Palo Alto only.",
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        product: input.product,
        outOfStockAt: preferredStore,
        inStockAt: alternateStore,
        respond: {
          sku: "SHORT-SKU",
          name: "exact product name",
          category: "Tablet|Phone|Smartwatch|Laptop|Headphones|Camera|Accessory",
          price: "$NNN",
          unavailableStore: preferredStore,
          availableStore: alternateStore,
          availableQuantity: 3,
          eta: "Back in X days",
          unspec: "one sentence",
          spec: "one sentence",
        },
      }),
    },
  ];

  try {
    if (shouldLogRetailOpenAi()) {
      console.log(
        "[Retail/OpenAI][inventory] Request:",
        JSON.stringify(
          {
            model,
            temperature: 0.35,
            max_tokens: 520,
            response_format: { type: "json_object" },
            messages,
          },
          null,
          2
        )
      );
    }

    const startedAt = Date.now();
    const completion = await withTimeout(
      client.chat.completions.create({
        model,
        temperature: 0.35,
        max_tokens: 150,
        response_format: { type: "json_object" },
        messages,
      }),
      RETAIL_DYNAMIC_LOOKUP_TIMEOUT_MS,
      `Dynamic inventory lookup timed out after ${RETAIL_DYNAMIC_LOOKUP_TIMEOUT_MS}ms`
    );

    if (shouldLogRetailOpenAi()) {
      console.log(
        "[Retail/OpenAI][inventory] Response:",
        JSON.stringify(
          {
            model,
            durationMs: Date.now() - startedAt,
            usage: completion.usage,
            content: completion.choices[0]?.message?.content || "",
          },
          null,
          2
        )
      );
    }

    const raw = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);
    // Support both slimmed shape (top-level fields) and legacy shape (requestedProduct wrapper)
    const productData = parsed.sku ? parsed : parsed.requestedProduct;
    const products = productData
      ? buildInventoryPairFromGeneratedItem(productData)
      : [];
    const items = products.filter((item) => !hasDemoBrand(item.name));
    const available = items.filter((item) => item.status !== "out_of_stock" && item.quantity > 0);
    const unavailable = items.filter((item) => item.status === "out_of_stock" || item.quantity <= 0);
    const recommendation = available[0] || null;

    if (!items.length || !recommendation) return null;

    const result: InventoryLookupResult = {
      items,
      available,
      unavailable,
      recommendation,
      generatedBy: `openai:${model}`,
    };
    inventoryLookupCache.set(cacheKey, result);
    return result;
  } catch (error: any) {
    console.error("Dynamic inventory lookup failed:", error?.message || error);
    return null;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (timeoutMs <= 0) return promise;

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
      note: sanitizeGeneratedText(item?.unspec || `${unavailableStore} is temporarily out of stock.`),
    },
    {
      sku,
      name,
      category,
      store: availableStore,
      status: "in_stock",
      quantity,
      price,
      note: sanitizeGeneratedText(item?.spec || `Available for pickup at ${availableStore}.`),
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

async function generateGiftAccessoryRecommendation(
  input: AccessoryRecommendationInput
): Promise<AccessoryRecommendation | null> {
  if (!process.env.OPENAI_API_KEY || !input.product) {
    return null;
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.RETAIL_RECOMMENDATION_MODEL || "gpt-4o-mini";
  const customer = RETAIL_STORE_ASSISTANT_USE_CASE.customer;
  const messages = [
    {
      role: "system" as const,
      content:
        "Generate one personalized accessory recommendation for a real-time consumer electronics retail agent. Return strict JSON only. Use real accessory naming compatible with the reserved product. The assistant MUST naturally bring up that in a previous conversation, the customer mentioned this purchase is a birthday gift for their daughter, who likes purple. Suggest a purple accessory (like a purple case) compatible with the reserved product, and mention that it can be reserved together with it. Be natural, conversational, and avoid sounding rigidly scripted. Do not use fictional demo brands such as AeroTab, NovaBook, PulseWatch, Orbit Phone, PageLite, SonicWave, PlayBox, HomeMesh, EchoNest, ViewMax, SkyLite, or VistaCam. If no natural personalized accessory exists, return name as an empty string.",
    },
    {
      role: "user" as const,
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
            "Customer previously mentioned the purchase is a birthday gift for their daughter.",
            "Daughter likes purple accessories.",
            "Order activity suggests Mayada prefers add-ons that make same-day pickup complete.",
            "Past SMS engagement shows Mayada responds well to concise, useful add-on suggestions.",
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
            "One natural, conversational sentence the assistant can say. It should mention the daughter's birthday and her preference for purple, and offer a matching purple accessory that's in stock. If original request differs from reserved product, start with 'For the [reserved product] we reserved...' and do not imply the accessory fits the original requested product.",
        },
      }),
    },
  ];

  try {
    if (shouldLogRetailOpenAi()) {
      console.log(
        "[Retail/OpenAI][accessory] Request:",
        JSON.stringify(
          {
            model,
            temperature: 0.55,
            max_tokens: 520,
            response_format: { type: "json_object" },
            messages,
          },
          null,
          2
        )
      );
    }

    const startedAt = Date.now();
    const completion = await withTimeout(
      client.chat.completions.create({
        model,
        temperature: 0.55,
        max_tokens: 520,
        response_format: { type: "json_object" },
        messages,
      }),
      RETAIL_DYNAMIC_LOOKUP_TIMEOUT_MS,
      `Dynamic accessory recommendation timed out after ${RETAIL_DYNAMIC_LOOKUP_TIMEOUT_MS}ms`
    );

    if (shouldLogRetailOpenAi()) {
      console.log(
        "[Retail/OpenAI][accessory] Response:",
        JSON.stringify(
          {
            model,
            durationMs: Date.now() - startedAt,
            usage: completion.usage,
            content: completion.choices[0]?.message?.content || "",
          },
          null,
          2
        )
      );
    }

    const raw = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);
    const name = sanitizeGeneratedText(parsed.name || "");
    if (!name || hasDemoBrand(name)) return null;

    const resolvedStore = /san jose|palo alto/i.test(input.store) ? input.store : "Palo Alto";
    const item: RetailInventoryItem = {
      sku: sanitizeSku(parsed.sku || name),
      name,
      category: "Accessory",
      store: resolvedStore,
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

function normStr(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenizeForMatch(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
}

function tokenOverlapScore(catalogName: string, input: string): number {
  const catalogTokens = tokenizeForMatch(catalogName);
  const inputTokens = tokenizeForMatch(input);
  const matches = catalogTokens.filter((t) => inputTokens.includes(t)).length;
  return matches / catalogTokens.length;
}

function findInventoryItem(productOrSku: string): RetailInventoryItem | undefined {
  const query = productOrSku.toLowerCase();
  const queryNorm = normStr(productOrSku);

  const storeMatch = (item: RetailInventoryItem) => item.store.toLowerCase().includes(DEFAULT_STORE.toLowerCase());

  // 1. Exact SKU or name match
  const exact = RETAIL_STORE_ASSISTANT_USE_CASE.inventory.find((item) => {
    const matchesProduct =
      item.sku.toLowerCase() === query ||
      item.name.toLowerCase() === query ||
      normStr(item.name) === queryNorm;
    return matchesProduct && storeMatch(item);
  });
  if (exact) return exact;

  // 2. Best token overlap (≥50% of catalog item name tokens must match)
  let best: RetailInventoryItem | undefined;
  let bestScore = 0;
  for (const item of RETAIL_STORE_ASSISTANT_USE_CASE.inventory) {
    if (!storeMatch(item)) continue;
    const score = tokenOverlapScore(item.name, productOrSku);
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return bestScore >= 0.5 ? best : undefined;
}

function findAvailableInventoryItemBySku(sku: string): RetailInventoryItem | undefined {
  return RETAIL_STORE_ASSISTANT_USE_CASE.inventory.find(
    (item) => item.sku === sku && item.status !== "out_of_stock" && item.quantity > 0
  );
}
