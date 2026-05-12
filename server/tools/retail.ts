import {
  RETAIL_STORE_ASSISTANT_USE_CASE,
  getRetailInventoryStatusLabel,
  type RetailInventoryItem,
} from "@shared/use-cases";

type ToolResult = { success: boolean; result?: string; error?: string; data?: unknown };

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
      "Reserve an available product for the customer at the selected store and pickup time.",
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
          description: "Pickup time requested by the customer.",
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
      required: ["store", "pickupTime"],
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
          description: "Primary product the customer is considering.",
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
    result: `Fetched ${conversationLimit} conversations plus previous orders, issues, and engagement history for John.`,
    data: {
      customerId: String(args.customerId || "cust-john-042"),
      conversationCount: conversationLimit,
      previousOrder: {
        orderId: "ORD-88421",
        date: "May 3",
        item: "AeroTab 11-inch, 256GB, Blue",
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
        "Viewed AeroTab 11-inch product page three times this week",
        "Clicked pickup availability for San Jose and Palo Alto",
        "Previously responded well to concise SMS follow-up",
      ],
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
  const query = String(args.product || "").trim().toLowerCase();
  if (!query) {
    return { success: false, error: "Product is required for inventory lookup" };
  }

  const matches = RETAIL_STORE_ASSISTANT_USE_CASE.inventory.filter((item) => {
    const text = `${item.sku} ${item.name} ${item.category} ${item.store}`.toLowerCase();
    return query
      .split(/\s+/)
      .filter(Boolean)
      .some((part) => text.includes(part));
  });

  if (matches.length === 0) {
    return {
      success: true,
      result: `${String(args.product || "That item").trim()} is not showing as available in the current inventory right now. Similar products, nearby availability, or a back-in-stock notification may still be possible.`,
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

  const items = matches;
  const available = items.filter((item) => item.status !== "out_of_stock" && item.quantity > 0);
  const unavailable = items.filter((item) => item.status === "out_of_stock" || item.quantity <= 0);
  const recommendation =
    available.find((item) => item.store === "Palo Alto") ||
    available[0] ||
    items[0];

  return {
    success: true,
    result: [
      unavailable.length
        ? `${unavailable[0].name} is out of stock at ${unavailable[0].store}.`
        : null,
      recommendation
        ? `${recommendation.name} is ${getRetailInventoryStatusLabel(recommendation.status).toLowerCase()} at ${recommendation.store}.`
        : null,
    ]
      .filter(Boolean)
      .join(" "),
    data: {
      query,
      items,
      available,
      unavailable,
      recommendation,
    },
  };
}

export async function reserve_item(args: Record<string, any>): Promise<ToolResult> {
  const store = String(args.store || RETAIL_STORE_ASSISTANT_USE_CASE.associatePlaybook.reservedStore).trim();
  const pickupTime = String(args.pickupTime || RETAIL_STORE_ASSISTANT_USE_CASE.associatePlaybook.pickupTime).trim();
  const product = String(args.product || args.sku || RETAIL_STORE_ASSISTANT_USE_CASE.associatePlaybook.reservedItem).trim();
  const customerName = String(args.customerName || RETAIL_STORE_ASSISTANT_USE_CASE.customer.name).trim();

  const item = findInventoryItem(product, store);
  if (!item || item.status === "out_of_stock" || item.quantity <= 0) {
    return {
      success: false,
      error: `${product || "That item"} is not available for reservation at ${store}.`,
      data: { product, store, pickupTime, customerName },
    };
  }

  const reservation = {
    reservationId: "RSV-430-JOHN",
    customerName,
    item,
    store,
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
  const accessory = RETAIL_STORE_ASSISTANT_USE_CASE.inventory.find((item) => item.sku === "CASE-PURPLE-11");

  return {
    success: true,
    result: accessory
      ? `Recommend ${accessory.name} because John mentioned this is a birthday gift and his daughter likes purple accessories.`
      : "No personalized accessory is available in the current inventory data.",
    data: {
      product,
      recommendation: accessory,
      rationale: "Persistent customer memory: birthday gift for daughter plus purple accessory preference.",
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

function findInventoryItem(productOrSku: string, store: string): RetailInventoryItem | undefined {
  const query = productOrSku.toLowerCase();
  const normalizedStore = store.toLowerCase();
  return RETAIL_STORE_ASSISTANT_USE_CASE.inventory.find((item) => {
    const matchesProduct =
      item.sku.toLowerCase() === query ||
      item.name.toLowerCase().includes(query) ||
      query.includes(item.name.toLowerCase()) ||
      query.includes(item.category.toLowerCase());
    return matchesProduct && item.store.toLowerCase().includes(normalizedStore);
  });
}
