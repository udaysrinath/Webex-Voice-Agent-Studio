import {
  RETAIL_STORE_ASSISTANT_USE_CASE,
  getRetailInventoryStatusLabel,
  type RetailActionPlan,
  type RetailInventoryItem,
} from "@shared/use-cases";

type ToolResult = { success: boolean; result?: string; error?: string; data?: unknown };

export const retailTools = [
  {
    type: "function" as const,
    name: "retail_get_customer_context",
    description:
      "Retrieve the verified customer's profile, preferences, and previous interactions.",
    parameters: {
      type: "object",
      properties: {
        customerName: {
          type: "string",
          description: "Optional customer name if the caller supplied one.",
        },
        phone: {
          type: "string",
          description: "Caller phone number in E.164 format or the phone number supplied for verification.",
        },
      },
      required: ["phone"],
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
          description: "Verified customer phone number in E.164 format.",
        },
      },
      required: ["store", "pickupTime", "phone"],
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
          description: "Verified customer phone number in E.164 format.",
        },
      },
      required: ["product", "phone"],
    },
  },
  {
    type: "function" as const,
    name: "retail_create_associate_handoff",
    description:
      "Create the post-call associate playbook with customer intent, reserved item, pickup time, and upsell recommendation.",
    parameters: {
      type: "object",
      properties: {
        customerName: {
          type: "string",
          description: "Customer name.",
        },
        intent: {
          type: "string",
          description: "Short summary of what the customer wants.",
        },
        reservedItem: {
          type: "string",
          description: "Reserved product.",
        },
        pickupTime: {
          type: "string",
          description: "Pickup time.",
        },
        recommendedUpsell: {
          type: "string",
          description: "Recommended add-on or upsell.",
        },
        phone: {
          type: "string",
          description: "Verified customer phone number in E.164 format.",
        },
      },
      required: ["customerName", "intent", "phone"],
    },
  },
];

export async function get_customer_context(args: Record<string, any>): Promise<ToolResult> {
  const customer = RETAIL_STORE_ASSISTANT_USE_CASE.customer;
  const suppliedName = typeof args.customerName === "string" ? args.customerName.trim() : "";
  const suppliedPhone = typeof args.phone === "string" ? args.phone.trim() : "";
  const verified = isVerifiedCustomerPhone(suppliedPhone);

  if (!verified) {
    return {
      success: false,
      error: suppliedPhone
        ? "Customer verification failed. Continue with generic product help only."
        : "Customer phone number is required before loading profile, previous chats, preferences, reservations, or personalized context.",
      data: {
        verificationRequired: true,
        suppliedName,
        suppliedPhone: suppliedPhone ? maskPhone(suppliedPhone) : "",
      },
    };
  }

  return {
    success: true,
    result: `Verified ${customer.name} (${customer.loyaltyTier}). ${customer.intent}`,
    data: {
      confidence: "verified-phone",
      verified: true,
      customer,
      pastChats: customer.pastChats,
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
  const verification = requireVerifiedPhone(args);
  if (verification) return verification;

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
  const verification = requireVerifiedPhone(args);
  if (verification) return verification;

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

export async function create_associate_handoff(args: Record<string, any>): Promise<ToolResult> {
  const verification = requireVerifiedPhone(args);
  if (verification) return verification;

  const defaultPlan = RETAIL_STORE_ASSISTANT_USE_CASE.associatePlaybook;
  const playbook: RetailActionPlan = {
    customerName: String(args.customerName || defaultPlan.customerName),
    intent: String(args.intent || defaultPlan.intent),
    reservedItem: String(args.reservedItem || defaultPlan.reservedItem),
    reservedStore: String(args.reservedStore || defaultPlan.reservedStore),
    pickupTime: String(args.pickupTime || defaultPlan.pickupTime),
    recommendedUpsell: String(args.recommendedUpsell || defaultPlan.recommendedUpsell),
    associateMessage: defaultPlan.associateMessage,
  };

  return {
    success: true,
    result: `Associate playbook created for ${playbook.customerName}: ${playbook.reservedItem}, pickup ${playbook.pickupTime}, recommend ${playbook.recommendedUpsell}.`,
    data: playbook,
  };
}

function requireVerifiedPhone(args: Record<string, any>): ToolResult | null {
  const phone = typeof args.phone === "string" ? args.phone.trim() : "";
  if (isVerifiedCustomerPhone(phone)) return null;

  return {
    success: false,
    error: "Customer phone verification is required before using profile memory, making reservations, personalized recommendations, or associate handoff actions.",
    data: {
      verificationRequired: true,
      suppliedPhone: phone ? maskPhone(phone) : "",
    },
  };
}

function isVerifiedCustomerPhone(phone: string): boolean {
  return normalizePhone(phone) === normalizePhone(RETAIL_STORE_ASSISTANT_USE_CASE.customer.phone);
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
