import assert from "node:assert/strict";

import {
  buildFakeReservationConfirmationResult,
  resolveReservationDeliveryChannel,
  sendReservationConfirmationEmail,
  type RetailReservationForDelivery,
} from "./reservation-delivery";

const reservation: RetailReservationForDelivery = {
  customerName: "John Rivera",
  itemName: "iPad Air",
  itemDetails: "iPad Air | SKU IPAD-AIR",
  store: "Palo Alto",
  pickupTime: "Friday at 2 PM",
  reservationId: "RSV-430-JOHN",
};

assert.equal(
  resolveReservationDeliveryChannel({
    requestedChannel: "unknown",
    env: {
      CUSTOMER_CONFIRMATION_EMAIL: "customer@example.com",
      DEMO_CONFIRMATION_EMAIL_WEBHOOK_URL: "https://email.example.test/send",
    },
    smsConfigured: false,
  }),
  "fake"
);

assert.equal(
  resolveReservationDeliveryChannel({
    requestedChannel: "email",
    env: {
      CUSTOMER_CONFIRMATION_EMAIL: "customer@example.com",
      DEMO_CONFIRMATION_EMAIL_WEBHOOK_URL: "https://email.example.test/send",
    },
    smsConfigured: false,
  }),
  "email"
);

assert.equal(
  resolveReservationDeliveryChannel({
    requestedChannel: "sms",
    env: {},
    smsConfigured: true,
  }),
  "sms"
);

assert.equal(
  resolveReservationDeliveryChannel({
    requestedChannel: "sms",
    env: {},
    smsConfigured: false,
  }),
  "fake"
);

const fakeResult = buildFakeReservationConfirmationResult(reservation);
assert.equal(fakeResult.success, true);
assert.match(fakeResult.result || "", /simulated/i);
assert.deepEqual(fakeResult.data, {
  deliveryChannel: "fake",
  simulated: true,
  reservationId: "RSV-430-JOHN",
});

const requests: Array<{ url: string; init: RequestInit }> = [];
const emailResult = await sendReservationConfirmationEmail(reservation, {
  env: {
    CUSTOMER_CONFIRMATION_EMAIL: "customer@example.com",
    DEMO_CONFIRMATION_EMAIL_WEBHOOK_URL: "https://email.example.test/send",
  },
  fetchImpl: async (url, init) => {
    requests.push({ url: String(url), init: init || {} });
    return new Response("ok", { status: 202 });
  },
});

assert.equal(emailResult.success, true);
assert.equal(requests.length, 1);
assert.equal(requests[0].url, "https://email.example.test/send");
assert.equal(requests[0].init.method, "POST");
assert.ok(requests[0].init.signal instanceof AbortSignal);
const payload = JSON.parse(String(requests[0].init.body));
assert.equal(payload.to, "customer@example.com");
assert.match(payload.subject, /Reservation confirmed/i);
assert.match(payload.text, /RSV-430-JOHN/);

console.log("reservation delivery routing regression passed");
