export type InventoryStatus = "in_stock" | "low_stock" | "out_of_stock";

export interface RetailPastChat {
  date: string;
  channel: "Webex" | "SMS" | "Store Visit";
  summary: string;
}

export interface RetailInventoryItem {
  sku: string;
  name: string;
  category: string;
  store: string;
  status: InventoryStatus;
  quantity: number;
  price: string;
  eta?: string;
  note: string;
}

export interface RetailCustomerProfile {
  name: string;
  phone: string;
  loyaltyTier: string;
  intent: string;
  preferredPickupTime: string;
  relationshipContext: string;
  preferences: string[];
  pastChats: RetailPastChat[];
}

export interface RetailActionPlan {
  customerName: string;
  intent: string;
  reservedItem: string;
  reservedStore: string;
  pickupTime: string;
  recommendedUpsell: string;
  associateMessage: string;
}

export interface VoiceUseCase {
  id: string;
  title: string;
  agentName: string;
  description: string;
  category: string;
  defaultLLM: string;
  defaultVoice: string;
  language: string;
  gender: string;
  heroMetric: string;
  demoGoal: string;
  capabilityChips: string[];
  recommendedTools: Array<{ name: string; description: string }>;
  customer: RetailCustomerProfile;
  inventory: RetailInventoryItem[];
  decisionTrace: Array<{ title: string; detail: string }>;
  associatePlaybook: RetailActionPlan;
}

type BayAreaStore = "San Jose" | "Palo Alto";

interface RetailCatalogItem {
  sku: string;
  name: string;
  category: string;
  price: string;
  unavailableStore: BayAreaStore;
  availableQuantity: number;
  eta: string;
  availableNote: string;
  unavailableNote: string;
  pairedAccessorySku?: string;
}

const BAY_AREA_CATALOG: RetailCatalogItem[] = [
    {
      sku: "IPAD-PRO-11-M4-256-BLU",
      name: "iPad Pro 11-inch, M4, 256GB, Blue",
      category: "Tablet",
      price: "$649",
      unavailableStore: "San Jose",
      availableQuantity: 3,
      eta: "Back in 5-7 days",
      unavailableNote: "The customer's first-choice tablet is not available at the current location.",
      availableNote: "Best fulfillment option for same-day pickup.",
      pairedAccessorySku: "CASE-IPAD-11-PURPLE",
    },
    {
      sku: "IPAD-MINI-128-SLV",
      name: "iPad mini, 128GB, Silver",
      category: "Tablet",
      price: "$399",
      unavailableStore: "San Jose",
      availableQuantity: 4,
      eta: "Back tomorrow",
      unavailableNote: "Compact tablet is temporarily sold through at San Jose.",
      availableNote: "Good same-day alternative for a smaller kid-friendly tablet.",
      pairedAccessorySku: "CASE-IPAD-MINI-PURPLE",
    },
    {
      sku: "LAP-ULTRA-14-M2-GRY",
      name: "MacBook Air 13-inch, M3, 16GB, Space Gray",
      category: "Laptop",
      price: "$1,299",
      unavailableStore: "San Jose",
      availableQuantity: 2,
      eta: "Back in 3-4 days",
      unavailableNote: "Popular laptop is currently sold out in San Jose.",
      availableNote: "Available for same-day pickup at the nearby store.",
      pairedAccessorySku: "ACC-LAP-USB-C-HUB",
    },
    {
      sku: "PHN-PRO-256-BLK",
      name: "Samsung Galaxy S25+, 256GB, Shadow Black",
      category: "Phone",
      price: "$999",
      unavailableStore: "San Jose",
      availableQuantity: 5,
      eta: "Back in 2 days",
      unavailableNote: "San Jose has no 256GB Shadow Black units left today.",
      availableNote: "Available with several same-day pickup slots.",
      pairedAccessorySku: "CASE-PHN-CLEAR-PRO",
    },
    {
      sku: "WATCH-APPLE-S9-45-MID",
      name: "Apple Watch Series 9, 45mm, Midnight",
      category: "Smartwatch",
      price: "$429",
      unavailableStore: "San Jose",
      availableQuantity: 6,
      eta: "Back next week",
      unavailableNote: "San Jose is out of this Apple Watch model today.",
      availableNote: "Available nearby with compatible bands and chargers.",
      pairedAccessorySku: "BAND-WATCH-SPORT-BLK",
    },
    {
      sku: "HEAD-NC-PRO-WHT",
      name: "Sony WH-1000XM5 Headphones, White",
      category: "Headphones",
      price: "$279",
      unavailableStore: "San Jose",
      availableQuantity: 3,
      eta: "Back in 48 hours",
      unavailableNote: "White headphones sold out at San Jose this morning.",
      availableNote: "Available for pickup with the current promo price.",
      pairedAccessorySku: "CASE-SONY-XM5-CARRY",
    },
    {
      sku: "EARBUDS-PRO-2-BLK",
      name: "Sony LinkBuds S Earbuds, Black",
      category: "Earbuds",
      price: "$189",
      unavailableStore: "San Jose",
      availableQuantity: 7,
      eta: "Back in 2-3 days",
      unavailableNote: "San Jose is temporarily out of the black earbuds.",
      availableNote: "Available nearby with same-day pickup.",
      pairedAccessorySku: "TIPS-SONY-LBS-FOAM",
    },
    {
      sku: "CAM-MIRRORLESS-4K-KIT",
      name: "Sony ZV-E10 II Mirrorless Kit",
      category: "Camera",
      price: "$899",
      unavailableStore: "San Jose",
      availableQuantity: 2,
      eta: "Back in 6 days",
      unavailableNote: "San Jose is waiting on the next camera shipment.",
      availableNote: "Available with lens kit and battery in stock.",
      pairedAccessorySku: "BAT-SONY-ZVE10II-SPARE",
    },
    {
      sku: "CONSOLE-PLAYBOX-X",
      name: "PlayStation 5 Slim Bundle",
      category: "Gaming Console",
      price: "$499",
      unavailableStore: "San Jose",
      availableQuantity: 4,
      eta: "Back this weekend",
      unavailableNote: "San Jose console bundles sold through today.",
      availableNote: "Available nearby with an extra controller bundle option.",
      pairedAccessorySku: "CTRL-PLAYBOX-WIRELESS",
    },
    {
      sku: "ROUTER-MESH-3PK",
      name: "Eero Max 7 Mesh Router 3-Pack",
      category: "Networking",
      price: "$449",
      unavailableStore: "San Jose",
      availableQuantity: 3,
      eta: "Back in 4 days",
      unavailableNote: "San Jose is out of the three-pack kit.",
      availableNote: "Available for same-day pickup in the neighboring store.",
      pairedAccessorySku: "EXTENDER-EERO-PRO7",
    },
    {
      sku: "SPKR-SMART-HUB-CHAR",
      name: "Amazon Echo Hub, Charcoal",
      category: "Smart Home",
      price: "$129",
      unavailableStore: "San Jose",
      availableQuantity: 8,
      eta: "Back tomorrow",
      unavailableNote: "San Jose is out of the charcoal Echo Hub.",
      availableNote: "Available nearby with home automation starter kits.",
      pairedAccessorySku: "HUB-ECHO-SMART-PLUG",
    },
    {
      sku: "MON-ULTRAWIDE-34",
      name: "LG UltraWide 34-inch Monitor",
      category: "Monitor",
      price: "$549",
      unavailableStore: "San Jose",
      availableQuantity: 2,
      eta: "Back in 5 days",
      unavailableNote: "San Jose has no ultrawide monitors left today.",
      availableNote: "Available for pickup with desk-arm accessories nearby.",
      pairedAccessorySku: "ARM-MON-LG-34-DESK",
    },
    {
      sku: "DRONE-MINI-4K",
      name: "DJI Mini 4 Pro Drone",
      category: "Drone",
      price: "$379",
      unavailableStore: "San Jose",
      availableQuantity: 3,
      eta: "Back in 3 days",
      unavailableNote: "San Jose is out of the compact drone kit.",
      availableNote: "Available nearby with spare battery packs.",
      pairedAccessorySku: "BAT-DRONE-MINI-SPARE",
    },
    {
      sku: "READER-PAPER-32",
      name: "Kindle Paperwhite Signature Edition, 32GB",
      category: "E-Reader",
      price: "$159",
      unavailableStore: "San Jose",
      availableQuantity: 5,
      eta: "Back next week",
      unavailableNote: "San Jose is temporarily out of the 32GB Paperwhite.",
      availableNote: "Available for same-day pickup in Palo Alto.",
      pairedAccessorySku: "CASE-KINDLE-PW-FABRIC",
    },
    {
      sku: "CASE-IPAD-11-PURPLE",
      name: "Purple Protective Case for iPad 11-inch",
      category: "Accessory",
      price: "$49",
      unavailableStore: "San Jose",
      availableQuantity: 8,
      eta: "Back tomorrow",
      unavailableNote: "San Jose is out of the purple tablet case today.",
      availableNote: "Personalized upsell based on the customer's previous birthday-gift context.",
    },
    {
      sku: "PENCIL-APPLE-USB-C",
      name: "Apple Pencil USB-C",
      category: "Accessory",
      price: "$89",
      unavailableStore: "San Jose",
      availableQuantity: 2,
      eta: "Back in 2 days",
      unavailableNote: "San Jose is out of the stylus today.",
      availableNote: "Available in Palo Alto for drawing and school projects.",
    },
    {
      sku: "BAND-WATCH-SPORT-BLK",
      name: "Sport Band for Apple Watch, Midnight",
      category: "Accessory",
      price: "$39",
      unavailableStore: "San Jose",
      availableQuantity: 9,
      eta: "Back tomorrow",
      unavailableNote: "San Jose is out of the Midnight sport band today.",
      availableNote: "Compatible daily-wear band for Apple Watch pickups.",
    },
    {
      sku: "CHG-WATCH-MAG-USB-C",
      name: "Apple Watch Magnetic Fast Charger to USB-C",
      category: "Accessory",
      price: "$29",
      unavailableStore: "San Jose",
      availableQuantity: 7,
      eta: "Back in 2 days",
      unavailableNote: "San Jose is out of spare Apple Watch chargers today.",
      availableNote: "Useful backup charger for Apple Watch buyers.",
    },
    {
      sku: "CASE-PHN-CLEAR-PRO",
      name: "Clear Protective Case for Galaxy S25+",
      category: "Accessory",
      price: "$45",
      unavailableStore: "San Jose",
      availableQuantity: 10,
      eta: "Back tomorrow",
      unavailableNote: "San Jose is out of clear phone cases today.",
      availableNote: "Compatible protection for the Galaxy S25+.",
    },
    {
      sku: "ACC-LAP-USB-C-HUB",
      name: "7-in-1 USB-C Travel Hub",
      category: "Accessory",
      price: "$69",
      unavailableStore: "San Jose",
      availableQuantity: 6,
      eta: "Back in 3 days",
      unavailableNote: "San Jose is out of USB-C travel hubs.",
      availableNote: "Helpful laptop add-on for displays, cards, and USB accessories.",
    },
    {
      sku: "CTRL-PLAYBOX-WIRELESS",
      name: "Extra Wireless Controller for PS5",
      category: "Accessory",
      price: "$59",
      unavailableStore: "San Jose",
      availableQuantity: 5,
      eta: "Back this weekend",
      unavailableNote: "San Jose is out of extra PS5 controllers.",
      availableNote: "Good second-player add-on for PS5 bundle pickups.",
    },
    {
      sku: "PHN-APPLE-IP16PM-256-NTL",
      name: "iPhone 16 Pro Max, 256GB, Natural Titanium",
      category: "Phone",
      price: "$1,199",
      unavailableStore: "San Jose",
      availableQuantity: 4,
      eta: "Back in 3 days",
      unavailableNote: "San Jose is currently out of the 256GB Natural Titanium model.",
      availableNote: "Available for same-day pickup at Palo Alto.",
      pairedAccessorySku: "CASE-IP16PM-CLEAR",
    },
    {
      sku: "EARBUDS-APPLE-APP-PRO2",
      name: "AirPods Pro (2nd generation)",
      category: "Earbuds",
      price: "$249",
      unavailableStore: "San Jose",
      availableQuantity: 6,
      eta: "Back in 2 days",
      unavailableNote: "San Jose is temporarily out of AirPods Pro.",
      availableNote: "Available with MagSafe charging case at Palo Alto.",
      pairedAccessorySku: "CHG-AIRPODS-MAGSAFE",
    },
    {
      sku: "TAB-IPAD-AIR-13-M2-BLU",
      name: "iPad Air 13-inch, M2, 128GB, Blue",
      category: "Tablet",
      price: "$799",
      unavailableStore: "San Jose",
      availableQuantity: 3,
      eta: "Back in 4 days",
      unavailableNote: "San Jose is out of the 13-inch iPad Air in Blue.",
      availableNote: "Great large-screen option available at Palo Alto.",
      pairedAccessorySku: "CASE-IPAD-AIR-13-BLU",
    },
    {
      sku: "HEADSET-META-QUEST3-128",
      name: "Meta Quest 3 VR Headset, 128GB",
      category: "VR Headset",
      price: "$499",
      unavailableStore: "San Jose",
      availableQuantity: 3,
      eta: "Back in 5 days",
      unavailableNote: "San Jose is out of the Meta Quest 3.",
      availableNote: "Available with touch controllers included at Palo Alto.",
      pairedAccessorySku: "STRAP-META-QUEST3-ELITE",
    },
    {
      sku: "CONSOLE-NINTENDO-SW2",
      name: "Nintendo Switch 2",
      category: "Gaming Console",
      price: "$449",
      unavailableStore: "San Jose",
      availableQuantity: 5,
      eta: "Back this weekend",
      unavailableNote: "San Jose sold through all Nintendo Switch 2 units.",
      availableNote: "Available for same-day pickup at Palo Alto.",
      pairedAccessorySku: "CASE-NSW2-CARRY",
    },
    {
      sku: "HEAD-BOSE-QC45-BLK",
      name: "Bose QuietComfort 45 Headphones, Black",
      category: "Headphones",
      price: "$329",
      unavailableStore: "San Jose",
      availableQuantity: 4,
      eta: "Back in 3 days",
      unavailableNote: "San Jose is out of the Bose QC45 in Black.",
      availableNote: "Available with carrying case at Palo Alto.",
      pairedAccessorySku: "CASE-BOSE-QC45-CARRY",
    },
    {
      sku: "CAM-GOPRO-H13-BLK",
      name: "GoPro Hero 13 Black",
      category: "Camera",
      price: "$399",
      unavailableStore: "San Jose",
      availableQuantity: 4,
      eta: "Back in 4 days",
      unavailableNote: "San Jose is waiting on the next GoPro shipment.",
      availableNote: "Available with standard mount kit at Palo Alto.",
      pairedAccessorySku: "MNT-GOPRO-H13-CHEST",
    },
    {
      sku: "WATCH-SAMSUNG-GW7-BLK",
      name: "Samsung Galaxy Watch 7, 44mm, Graphite",
      category: "Smartwatch",
      price: "$299",
      unavailableStore: "San Jose",
      availableQuantity: 5,
      eta: "Back in 2 days",
      unavailableNote: "San Jose is out of the 44mm Graphite Galaxy Watch 7.",
      availableNote: "Available with compatible bands at Palo Alto.",
      pairedAccessorySku: "BAND-SAMSUNG-GW7-SPORT"
    },
    {
      sku: "BAT-DRONE-MINI-SPARE",
      name: "Spare Battery Pack for DJI Mini 4 Pro",
      category: "Accessory",
      price: "$79",
      unavailableStore: "San Jose",
      availableQuantity: 4,
      eta: "Back in 4 days",
      unavailableNote: "San Jose is out of spare drone batteries.",
      availableNote: "Extends flight time for the DJI Mini 4 Pro.",
    },
    {
      sku: "CASE-IPAD-MINI-PURPLE",
      name: "Purple Folio Case for iPad mini",
      category: "Accessory",
      price: "$45",
      unavailableStore: "San Jose",
      availableQuantity: 6,
      eta: "Back tomorrow",
      unavailableNote: "San Jose is out of the purple iPad mini folio case.",
      availableNote: "Perfect color-matching case for the iPad mini.",
    },
    {
      sku: "CASE-IPAD-AIR-13-BLU",
      name: "Smart Folio Case for iPad Air 13-inch, Blue",
      category: "Accessory",
      price: "$79",
      unavailableStore: "San Jose",
      availableQuantity: 4,
      eta: "Back in 2 days",
      unavailableNote: "San Jose is out of the blue folio case for iPad Air 13-inch.",
      availableNote: "Color-matched case for the iPad Air 13-inch at Palo Alto.",
    },
    {
      sku: "CASE-IP16PM-CLEAR",
      name: "Clear Case for iPhone 16 Pro Max",
      category: "Accessory",
      price: "$49",
      unavailableStore: "San Jose",
      availableQuantity: 8,
      eta: "Back tomorrow",
      unavailableNote: "San Jose is out of the clear iPhone 16 Pro Max case.",
      availableNote: "MagSafe-compatible clear protection at Palo Alto.",
    },
    {
      sku: "CHG-AIRPODS-MAGSAFE",
      name: "MagSafe Charging Case for AirPods Pro",
      category: "Accessory",
      price: "$39",
      unavailableStore: "San Jose",
      availableQuantity: 7,
      eta: "Back in 2 days",
      unavailableNote: "San Jose is out of MagSafe charging cases for AirPods Pro.",
      availableNote: "Replacement MagSafe case for AirPods Pro at Palo Alto.",
    },
    {
      sku: "CASE-SONY-XM5-CARRY",
      name: "Carrying Case for Sony WH-1000XM5",
      category: "Accessory",
      price: "$35",
      unavailableStore: "San Jose",
      availableQuantity: 5,
      eta: "Back in 3 days",
      unavailableNote: "San Jose is out of Sony XM5 carrying cases.",
      availableNote: "Slim hard-shell carry case for the Sony WH-1000XM5.",
    },
    {
      sku: "TIPS-SONY-LBS-FOAM",
      name: "Foam Ear Tips for Sony LinkBuds S",
      category: "Accessory",
      price: "$19",
      unavailableStore: "San Jose",
      availableQuantity: 9,
      eta: "Back tomorrow",
      unavailableNote: "San Jose is out of Sony LinkBuds S foam ear tips.",
      availableNote: "Comfort upgrade ear tips for Sony LinkBuds S.",
    },
    {
      sku: "BAT-SONY-ZVE10II-SPARE",
      name: "Spare Battery Pack for Sony ZV-E10 II",
      category: "Accessory",
      price: "$59",
      unavailableStore: "San Jose",
      availableQuantity: 4,
      eta: "Back in 3 days",
      unavailableNote: "San Jose is out of spare ZV-E10 II batteries.",
      availableNote: "Keep shooting longer with a spare battery at Palo Alto.",
    },
    {
      sku: "CASE-BOSE-QC45-CARRY",
      name: "Carrying Case for Bose QuietComfort 45",
      category: "Accessory",
      price: "$29",
      unavailableStore: "San Jose",
      availableQuantity: 6,
      eta: "Back in 2 days",
      unavailableNote: "San Jose is out of Bose QC45 carrying cases.",
      availableNote: "Protective travel case for the Bose QC45 at Palo Alto.",
    },
    {
      sku: "MNT-GOPRO-H13-CHEST",
      name: "Chest Mount for GoPro Hero 13",
      category: "Accessory",
      price: "$49",
      unavailableStore: "San Jose",
      availableQuantity: 5,
      eta: "Back in 3 days",
      unavailableNote: "San Jose is out of GoPro chest mounts.",
      availableNote: "Hands-free chest harness for GoPro Hero 13 at Palo Alto.",
    },
    {
      sku: "STRAP-META-QUEST3-ELITE",
      name: "Elite Strap for Meta Quest 3",
      category: "Accessory",
      price: "$69",
      unavailableStore: "San Jose",
      availableQuantity: 4,
      eta: "Back in 4 days",
      unavailableNote: "San Jose is out of Meta Quest 3 elite straps.",
      availableNote: "Ergonomic comfort upgrade for Meta Quest 3 at Palo Alto.",
    },
    {
      sku: "CASE-NSW2-CARRY",
      name: "Carrying Case for Nintendo Switch 2",
      category: "Accessory",
      price: "$29",
      unavailableStore: "San Jose",
      availableQuantity: 7,
      eta: "Back this weekend",
      unavailableNote: "San Jose is out of Nintendo Switch 2 carrying cases.",
      availableNote: "Hard-shell travel case for the Nintendo Switch 2 at Palo Alto.",
    },
    {
      sku: "BAND-SAMSUNG-GW7-SPORT",
      name: "Sport Band for Samsung Galaxy Watch 7, Graphite",
      category: "Accessory",
      price: "$29",
      unavailableStore: "San Jose",
      availableQuantity: 8,
      eta: "Back in 2 days",
      unavailableNote: "San Jose is out of the Graphite sport band for Galaxy Watch 7.",
      availableNote: "Matching sport band for the Galaxy Watch 7 at Palo Alto.",
    },
    {
      sku: "CASE-KINDLE-PW-FABRIC",
      name: "Fabric Cover for Kindle Paperwhite, Black",
      category: "Accessory",
      price: "$35",
      unavailableStore: "San Jose",
      availableQuantity: 6,
      eta: "Back next week",
      unavailableNote: "San Jose is out of Kindle Paperwhite fabric covers.",
      availableNote: "Slim fabric cover with auto wake/sleep for Kindle Paperwhite.",
    },
    {
      sku: "EXTENDER-EERO-PRO7",
      name: "Eero Pro 7 Range Extender",
      category: "Accessory",
      price: "$149",
      unavailableStore: "San Jose",
      availableQuantity: 3,
      eta: "Back in 4 days",
      unavailableNote: "San Jose is out of Eero Pro 7 range extenders.",
      availableNote: "Extends Eero mesh coverage to hard-to-reach areas at Palo Alto.",
    },
    {
      sku: "HUB-ECHO-SMART-PLUG",
      name: "Amazon Smart Plug (2-Pack)",
      category: "Accessory",
      price: "$25",
      unavailableStore: "San Jose",
      availableQuantity: 10,
      eta: "Back tomorrow",
      unavailableNote: "San Jose is out of Amazon Smart Plug 2-packs.",
      availableNote: "Works seamlessly with the Echo Hub for home automation.",
    },
    {
      sku: "ARM-MON-LG-34-DESK",
      name: "Desk Mount Arm for LG UltraWide 34-inch",
      category: "Accessory",
      price: "$89",
      unavailableStore: "San Jose",
      availableQuantity: 3,
      eta: "Back in 5 days",
      unavailableNote: "San Jose is out of desk mount arms for the LG UltraWide.",
      availableNote: "Adjustable desk arm for the LG UltraWide 34-inch at Palo Alto.",
    },
];

function buildBayAreaInventory(): RetailInventoryItem[] {
  return BAY_AREA_CATALOG.flatMap((item) => {
    const availableStore: BayAreaStore = item.unavailableStore === "San Jose" ? "Palo Alto" : "San Jose";

    return [
      {
        sku: item.sku,
        name: item.name,
        category: item.category,
        store: item.unavailableStore,
        status: "out_of_stock" as const,
        quantity: 0,
        price: item.price,
        eta: item.eta,
        note: item.unavailableNote,
      },
      {
        sku: item.sku,
        name: item.name,
        category: item.category,
        store: availableStore,
        status: "in_stock" as const,
        quantity: item.availableQuantity,
        price: item.price,
        note: item.availableNote,
      },
    ];
  });
}

export function getAccessoryForProduct(
  productName: string,
  inventory: RetailInventoryItem[]
): RetailInventoryItem | undefined {
  const nameLower = productName.toLowerCase();
  const catalogItem =
    BAY_AREA_CATALOG.find((c) => c.name.toLowerCase() === nameLower) ??
    BAY_AREA_CATALOG.find(
      (c) =>
        c.pairedAccessorySku &&
        (c.name.toLowerCase().includes(nameLower) || nameLower.includes(c.name.toLowerCase()))
    );
  if (!catalogItem?.pairedAccessorySku) return undefined;
  return inventory.find(
    (item) => item.sku === catalogItem.pairedAccessorySku && item.status !== "out_of_stock"
  );
}

export const RETAIL_STORE_ASSISTANT_USE_CASE: VoiceUseCase = {
  id: "retail-customer-cross-store",
  title: "Retail Store Assistant",
  agentName: "Store Assistant",
  description:
    "A retail voice agent that recognizes a returning customer, checks inventory across stores, reserves items, sends SMS follow-up, and prepares the store manager.",
  category: "Retail demo",
  defaultLLM: "gpt-4o",
  defaultVoice: "marin",
  language: "en-US",
  gender: "neutral",
  heroMetric: "Cross-store conversion",
  demoGoal:
    "Show continuity across sessions, real-time inventory reasoning, reservation action, SMS follow-up, and a Webex-ready store manager handoff.",
  capabilityChips: [
    "Customer memory",
    "Inventory lookup",
    "Cross-store options",
    "Reservation",
    "Summary SMS",
    "Store manager Webex",
  ],
  recommendedTools: [
    {
      name: "retail_user_lookup",
      description: "Silently identify the caller profile when a call starts.",
    },
    {
      name: "retail_user_history_lookup",
      description: "Silently fetch previous orders, issues, and engagement history for later use.",
    },
    {
      name: "retail_get_customer_context",
      description: "Load the returning customer and their previous store interactions.",
    },
    {
      name: "retail_lookup_inventory",
      description: "Check product availability at the current and nearby stores.",
    },
    {
      name: "retail_reserve_item",
      description: "Reserve an available product for a customer-confirmed pickup date and time.",
    },
    {
      name: "retail_recommend_gift_accessory",
      description: "Dynamically choose a personalized accessory from current reservation, customer memory, and current-call context.",
    },
  ],
  customer: {
    name: "Mayada Abdelrahman",
    phone: "+16505550142",
    loyaltyTier: "Gold member",
    intent: "Find and reserve a tablet as a birthday gift for her daughter.",
    preferredPickupTime: "Customer chooses pickup date and time during the call",
    relationshipContext:
      "Mayada has shopped with the store before and expects the assistant to remember useful context without making her repeat it.",
    preferences: [
      "Birthday gift for her daughter",
      "Daughter likes purple accessories",
      "Prefers a quick pickup handoff once she chooses a pickup time",
      "Open to nearby store pickup when local inventory is unavailable",
    ],
    pastChats: [
      {
        date: "May 8",
        channel: "Webex",
        summary: "Mayada mentioned the tablet is a birthday gift and asked for kid-friendly accessory ideas.",
      }
    ],
  },
  inventory: buildBayAreaInventory(),
  decisionTrace: [
    {
      title: "Recognize returning customer",
      detail: "Use caller identity and past chats to retrieve purchase context and preferences.",
    },
    {
      title: "Check local stock",
      detail: "Confirm the requested tablet is unavailable at the current store.",
    },
    {
      title: "Reason across stores",
      detail: "Find same-day availability at Palo Alto and offer reservation or back-in-stock notification.",
    },
    {
      title: "Personalize next step",
      detail: "Recommend the purple case because the customer said this is a birthday gift for her daughter.",
    },
    {
      title: "Prepare manager handoff",
      detail: "Create a concise pickup playbook with intent, reserved items, pickup time, and upsell.",
    },
  ],
  associatePlaybook: {
    customerName: "Mayada Abdelrahman",
    intent: "Reserve an iPad as a birthday gift.",
    reservedItem: "iPad Pro 11-inch, M4, 256GB, Blue",
    reservedStore: "Palo Alto",
    pickupTime: "Customer-confirmed pickup time",
    recommendedUpsell: "Purple Protective Case for iPad 11-inch",
    associateMessage:
      "Mayada has a pickup scheduled for the customer-confirmed time. Mention the purple protective case and keep the reservation ready at the front counter.",
  },
};

export const VOICE_USE_CASES = [RETAIL_STORE_ASSISTANT_USE_CASE];

export function getRetailInventoryStatusLabel(status: InventoryStatus): string {
  switch (status) {
    case "in_stock":
      return "In stock";
    case "low_stock":
      return "Low stock";
    case "out_of_stock":
      return "Out of stock";
  }
}

export function isRetailStoreUseCasePrompt(prompt: string | undefined, agentName?: string): boolean {
  const text = `${agentName || ""}\n${prompt || ""}`.toLowerCase();
  return (
    text.includes("store assistant") ||
    text.includes("retail store assistant") ||
    text.includes("cross-store intelligence") ||
    text.includes("mayada abdelrahman") ||
    text.includes("ipad")
  );
}
