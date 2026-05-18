import assert from "node:assert/strict";

import { reserve_item } from "./retail";

const reservation = await reserve_item({
  product: "iPad Pro 11-inch, M4, 256GB, Blue",
  store: "Palo Alto",
  pickupDate: "Friday",
  pickupTime: "2 PM",
  customerName: "John",
});

assert.equal(reservation.success, true);
assert.match(reservation.result || "", /confirmation/i);
assert.match(reservation.result || "", /handled after the call/i);
assert.match(reservation.result || "", /RSV-430-JOHN/);

console.log("retail reservation confirmation regression passed");
