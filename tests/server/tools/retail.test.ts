import assert from "node:assert/strict";

import { lookup_inventory, reserve_item, search_products } from "../../../server/tools/retail";

const productSearch = await search_products({ query: "iPad mini" });
assert.equal(productSearch.success, true);
assert.match(productSearch.result || "", /call retail_lookup_inventory next without asking for pickup location/i);

const inventory = await lookup_inventory({ product: "iPad mini, 128GB, Silver" });
assert.equal(inventory.success, true);
assert.match(inventory.result || "", /Palo Alto/i);
assert.match(inventory.result || "", /tomorrow at 2 PM/i);
assert.equal((inventory.data as any).suggestedPickupTime, "tomorrow at 2 PM");

const reservation = await reserve_item({
  product: "iPad Pro 11-inch, M4, 256GB, Blue",
  store: "Palo Alto",
  pickupDate: "Friday",
  pickupTime: "2 PM",
  customerName: "Mayada",
});

assert.equal(reservation.success, true);
assert.match(reservation.result || "", /confirmation/i);
assert.match(reservation.result || "", /handled after the call/i);
assert.match(reservation.result || "", /RSV-430-MAYADA/);

console.log("retail reservation confirmation regression passed");
