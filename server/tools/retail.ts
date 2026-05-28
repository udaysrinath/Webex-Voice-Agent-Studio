import {
  RETAIL_STORE_CATALOG,
  RETAIL_STORE_ASSISTANT_USE_CASE,
  getRetailInventoryStatusLabel,
  getAccessoryForProduct,
  type RetailInventoryItem,
} from "@shared/use-cases";
import OpenAI from "openai";
import {
  getDemoCustomerProfile,
  getDemoRetailCustomer,
} from "../voice-agent/dto";
import MiniSearch from 'minisearch';

type ToolResult = { success: boolean; result?: string; error?: string; data?: unknown };

const generatedInventory = new Map<string, RetailInventoryItem>();
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
      "Look up inventory by product or category across stores. Use this immediately after the caller selects a product so the assistant can state the available pickup store and propose a pickup time.",
    parameters: {
      type: "object",
      properties: {
        product: {
          type: "string",
          description: "Product name, category, or SKU to look up.",
        },
        preferredStore: {
          type: "string",
          description: "Optional location only when the caller already stated one. Do not ask for this before checking inventory.",
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

export async function profile_lookup(args: Record<string, any>): Promise<ToolResult> {
  const suppliedPhone = typeof args.phone === "string" ? args.phone.trim() : "";
  const customer = getDemoRetailCustomer();
  const profile = getDemoCustomerProfile();

  return {
    success: true,
    result: "Profile candidate found. Last-name confirmation is required before using customer details.",
    data: {
      customerId: profile.customerId,
      preferredName: profile.firstName,
      maskedFullName: profile.maskedName,
      phone: suppliedPhone ? maskPhone(suppliedPhone) : maskPhone(customer.phone),
      confirmationRequired: true,
      confirmationPrompt: `Based on your phone number, I found a profile for ${profile.firstName}. Can you confirm your last name?`,
    },
  };
}

export async function confirm_profile(args: Record<string, any>): Promise<ToolResult> {
  const suppliedLastName = String(args.lastName || "").trim();
  const profile = getDemoCustomerProfile();

  if (!suppliedLastName) {
    return {
      success: false,
      error: "Last-name confirmation is required before using the profile candidate.",
      result: "Ask the caller to provide their first and last name. Do not use customer details yet.",
      data: {
        verified: false,
        customerId: String(args.customerId || profile.customerId),
        reason: "missing-last-name",
      },
    };
  }

  return {
    success: true,
    result: `Profile confirmed after last-name confirmation. The caller is ${profile.name}.`,
    data: {
      verified: true,
      customerId: String(args.customerId || profile.customerId),
      customerName: profile.name,
      preferredName: profile.firstName,
      suppliedLastName,
      verificationMode: "last-name-provided",
      verifiedAt: Date.now(),
    },
  };
}

export async function user_lookup(args: Record<string, any>): Promise<ToolResult> {
  const suppliedPhone = typeof args.phone === "string" ? args.phone.trim() : "";
  const customer = getDemoRetailCustomer();
  const profile = getDemoCustomerProfile();

  return {
    success: true,
    result: `User lookup complete: ${profile.firstName} found as a returning Gold member.`,
    data: {
      customerId: profile.customerId,
      name: profile.firstName,
      fullName: profile.name,
      preferredName: profile.firstName,
      phone: suppliedPhone ? maskPhone(suppliedPhone) : maskPhone(customer.phone),
      email: profile.email,
      loyaltyTier: "Gold member",
      preferredStore: "ask caller",
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
    result: `Fetched ${conversationLimit} past conversations, previous orders, open issues, transactions, and engagement signals for ${getDemoCustomerProfile().firstName}. Context source: prior Webex/SMS conversations, order history, transaction activity, store visits, and browsing engagement.`,
    data: {
      customerId: String(args.customerId || getDemoCustomerProfile().customerId),
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
  const customer = getDemoRetailCustomer();
  const suppliedName = typeof args.customerName === "string" ? args.customerName.trim() : "";
  const suppliedPhone = typeof args.phone === "string" ? args.phone.trim() : "";

  return {
    success: true,
    result:
      "Customer context loaded. Use this context silently during product selection and inventory lookup; mention birthday-gift personalization only during the add-on recommendation.",
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
      usageGuidance:
        "Do not mention birthday-gift, daughter, purple preference, or prior-conversation context until retail_recommend_gift_accessory.",
    },
  };
}

export async function search_products(args: Record<string, any>): Promise<ToolResult> {
  const query = String(args.query || args.product || "").trim();
  if (!query) {
    return { success: false, error: "Product search query is required." };
  }

  const catalogItems = RETAIL_STORE_CATALOG.filter(
    (item) => item.category.toLowerCase() !== "accessory"
  );
  
  const miniSearch = new MiniSearch({
    fields: ['name', 'category', 'sku'],
    storeFields: ['sku', 'name', 'category', 'price'],
    idField: 'sku',
    searchOptions: {
      boost: { name: 2, category: 1.5, sku: 1 },
      fuzzy: 0.2
    }
  });
  
  miniSearch.addAll(catalogItems);
  const searchResults = miniSearch.search(query).slice(0, 6);
  
  const catalogMatches = searchResults.map((result) => ({
    sku: String(result.sku || ""),
    name: String(result.name || ""),
    category: String(result.category || ""),
    price: String(result.price || ""),
  }));

  if (catalogMatches.length === 0) {
    return {
      success: true,
      result: `No catalog match found for ${query}. Explicitly inform the caller that we do not carry this item or anything in this category in our store catalog. Do not offer nearby alternatives for this product.`,
      data: {
        query,
        matches: [],
        noMatch: true,
      },
    };
  }

  return {
    success: true,
    result: catalogMatches.length === 1
      ? `Found 1 catalog match for ${query}: ${catalogMatches[0].name}. This is product catalog information only. Call retail_lookup_inventory now without asking whether to check availability and without asking for pickup location first.`
      : `Found ${catalogMatches.length} catalog matches for ${query}: ${catalogMatches.map((item) => item.name).join("; ")}. This is product catalog information only. Ask the caller to choose one of these products, then call retail_lookup_inventory next without asking for pickup location first.`,
    data: {
      query,
      matches: catalogMatches,
      topMatch: catalogMatches[0],
      availabilityChecked: false,
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

  const ENABLE_STATIC_INVENTORY = process.env.ENABLE_STATIC_INVENTORY !== "false";

  if (ENABLE_STATIC_INVENTORY) {
    const items = RETAIL_STORE_ASSISTANT_USE_CASE.inventory.filter((item) => {
      const nameLower = item.name.toLowerCase();
      const skuLower = item.sku.toLowerCase();
      const catLower = item.category.toLowerCase();

      const fastPathRegex = new RegExp(`\\b${query.replace(/[^a-z0-9\s]/g, " ").trim().replace(/\s+/g, "\\b.*\\b")}\\b`);
      if (nameLower.includes(query) || fastPathRegex.test(catLower) || skuLower.includes(query) || query.includes(nameLower)) {
        return true;
      }

      // Word-overlap match: ignore generation numbers, storage sizes, colours
      // e.g. "iPad mini (6th Generation)" → ["ipad", "mini"] both appear in "iPad mini, 128GB, Silver"
      const queryWords = getProductQueryWords(query);

      if (queryWords.length >= 2) {
        const significantMatches = queryWords.filter((w) => {
          const regex = new RegExp(`\\b${w}\\b`);
          return regex.test(nameLower) || regex.test(skuLower) || regex.test(catLower);
        });
        return significantMatches.length >= Math.min(2, queryWords.length);
      }

      return queryWords.length === 1 && (new RegExp(`\\b${queryWords[0]}\\b`).test(nameLower) || new RegExp(`\\b${queryWords[0]}\\b`).test(skuLower));
    });

    if (items.length > 0) {
      const normalizedPreferredStore = preferredStore
        ? /palo alto/i.test(preferredStore) ? "Palo Alto" : "San Jose"
        : "";
      const available = items.filter((item) => item.status !== "out_of_stock" && item.quantity > 0);
      const unavailable = items.filter((item) => item.status === "out_of_stock" || item.quantity <= 0);

      const preferredUnavailable = normalizedPreferredStore
        ? unavailable.find(item => item.store === normalizedPreferredStore) || unavailable[0]
        : null;
      const recommendation = available[0] || null;
      // Use the caller's actual store name in the response, not the catalog's hardcoded store value
      const callerStore = preferredStore || preferredUnavailable?.store || normalizedPreferredStore;
      const suggestedPickupTime = "tomorrow at 2 PM";

      return {
        success: true,
        result: [
          preferredUnavailable
            ? `${preferredUnavailable.name} is out of stock at ${callerStore}.`
            : null,
          recommendation
            ? `${recommendation.name} is ${getRetailInventoryStatusLabel(recommendation.status).toLowerCase()} at ${recommendation.store}. Offer to have it ready for pickup ${suggestedPickupTime}.`
            : null,
        ]
          .filter(Boolean)
          .join(" ") || "Item found in static inventory but no availability formatting matched.",
        data: {
          query,
          items,
          available,
          unavailable,
          recommendation,
          suggestedPickupTime,
          generatedBy: "static-catalog",
        },
      };
    }
  }

  // Static is enabled but nothing matched — return fast not-found instead of calling OpenAI
  if (ENABLE_STATIC_INVENTORY) {
    return {
      success: false,
      error: `${product} was not found in the current store catalog. Please let the customer know and offer to check a different product or store.${preferredStore ? ` (checked for: ${preferredStore})` : ""}`,
      data: { query, generatedBy: "static-catalog" },
    };
  }

  // Static disabled — fall back to dynamic OpenAI lookup
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

function getProductQueryWords(query: string): string[] {
  return query
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !/^(\d+(st|nd|rd|th|gb|tb|mm|inch)?|generation|model|new|the|and|for|with)$/.test(w));
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
  const product = String(args.product || args.sku || "").trim();
  const customerName = String(args.customerName || getDemoRetailCustomer().name).trim();

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

  const item = findInventoryItem(product, store);
  if (!item || item.status === "out_of_stock" || item.quantity <= 0) {
    return {
      success: false,
      error: `${product || "That item"} is not available for reservation at ${store}.`,
      data: { product, store, pickupDate, pickupTime, customerName },
    };
  }

  const reservationId = `RSV-430-${getDemoCustomerProfile().firstName.toUpperCase()}`;
  const reservation = {
    reservationId,
    customerName,
    item,
    store,
    pickupDate,
    pickupTime,
    status: "confirmed",
    confirmationDelivery: {
      channel: "customer",
      status: "will_send_after_call",
      message: `Customer confirmation will be handled after the call. Reservation reference ${reservationId}.`,
    },
  };
  return {
    success: true,
    result: `${item.name} is reserved for ${customerName} at ${store} for ${pickupTime}. Customer confirmation will be handled after the call. Reservation reference ${reservationId}.`,
    data: reservation,
  };
}

export async function recommend_gift_accessory(args: Record<string, any>): Promise<ToolResult> {
  const product = String(args.product || "").trim();
  const originalRequest = String(args.originalRequest || "").trim();
  const store = String(args.store || "").trim();
  const recentConversationSummary = String(args.recentConversationSummary || "").trim();

  const ENABLE_STATIC_INVENTORY = process.env.ENABLE_STATIC_INVENTORY !== "false";

  let recommendation: AccessoryRecommendation | null = null;
  if (ENABLE_STATIC_INVENTORY) {
    // Direct catalog lookup: each product has an explicit pairedAccessorySku
    const pairedAccessory = getAccessoryForProduct(product, RETAIL_STORE_ASSISTANT_USE_CASE.inventory);
    const accessories = RETAIL_STORE_ASSISTANT_USE_CASE.inventory.filter(
      (item) => item.category.toLowerCase() === "accessory" && item.status !== "out_of_stock"
    );
    const accessory = pairedAccessory ?? accessories[0];

    if (accessory) {
      const isPurple = accessory.name.toLowerCase().includes("purple");
      const suggestedWording = isPurple
        ? `In our previous conversations you mentioned this is a birthday gift for your daughter and that she loves purple — would you like me to add a ${accessory.name} to go along with it?`
        : `In our previous conversations you mentioned this is a birthday gift for your daughter — I think a ${accessory.name} would be a great addition, would you like me to add that?`;
      recommendation = {
        item: accessory,
        reason: isPurple
          ? "it matches the customer's history indicating her daughter likes purple"
          : "it is a compatible accessory for the reserved product",
        source: "customer history plus product fit",
        personalizationSignal: isPurple
          ? "Customer previously mentioned the purchase is a birthday gift for their daughter who likes purple."
          : `Compatible accessory for ${product} selected from current inventory.`,
        suggestedWording,
        generatedBy: "static-catalog",
      };
    }
  } else {
    recommendation = await generateGiftAccessoryRecommendation({
      product,
      originalRequest,
      store,
      recentConversationSummary,
    });
  }

  const accessory = recommendation?.item;
  if (accessory) generatedInventory.set(accessory.sku, accessory);

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
          unavailableNote: "one sentence",
          availableNote: "one sentence",
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

async function generateGiftAccessoryRecommendation(
  input: AccessoryRecommendationInput
): Promise<AccessoryRecommendation | null> {
  if (!process.env.OPENAI_API_KEY || !input.product) {
    return null;
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.RETAIL_RECOMMENDATION_MODEL || "gpt-4o-mini";
  const customer = getDemoRetailCustomer();
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
            `Order activity suggests ${getDemoCustomerProfile().firstName} prefers add-ons that make same-day pickup complete.`,
            `Past SMS engagement shows ${getDemoCustomerProfile().firstName} responds well to concise, useful add-on suggestions.`,
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

function findInventoryItem(productOrSku: string, store: string): RetailInventoryItem | undefined {
  const query = productOrSku.toLowerCase();
  const queryNorm = normStr(productOrSku);
  const normalizedStore = store.toLowerCase();
  return [...Array.from(generatedInventory.values()), ...RETAIL_STORE_ASSISTANT_USE_CASE.inventory].find((item) => {
    const nameLower = item.name.toLowerCase();
    const nameNorm = normStr(item.name);
    const skuLower = item.sku.toLowerCase();
    const matchesProduct =
      skuLower === query ||
      nameLower === query ||
      nameNorm === queryNorm ||
      nameNorm.includes(queryNorm);
    return matchesProduct && item.store.toLowerCase().includes(normalizedStore);
  });
}

function findAvailableInventoryItemBySku(sku: string): RetailInventoryItem | undefined {
  return [...Array.from(generatedInventory.values()), ...RETAIL_STORE_ASSISTANT_USE_CASE.inventory].find(
    (item) => item.sku === sku && item.status !== "out_of_stock" && item.quantity > 0
  );
}
