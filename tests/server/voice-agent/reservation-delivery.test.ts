import assert from "node:assert/strict";

import {
  getReservationDeliverySpokenInstruction,
  resolveReservationDeliveryChannel,
  sendReservationConfirmationEmail,
  type RetailReservationForDelivery,
} from "../../../server/voice-agent/reservation-delivery";

const reservation: RetailReservationForDelivery = {
  customerName: "Mayada Abdelrahman",
  itemName: "iPad Air",
  itemDetails: "iPad Air | SKU IPAD-AIR",
  store: "Palo Alto",
  pickupTime: "Friday at 2 PM",
  reservationId: "RSV-430-MAYADA",
};

assert.equal(
  resolveReservationDeliveryChannel("unknown"),
  "sms"
);

assert.equal(
  resolveReservationDeliveryChannel(),
  "sms"
);

assert.equal(
  resolveReservationDeliveryChannel("email"),
  "email"
);

assert.equal(
  resolveReservationDeliveryChannel("sms"),
  "sms"
);

assert.equal(
  resolveReservationDeliveryChannel(" SMS "),
  "sms"
);

assert.match(getReservationDeliverySpokenInstruction("sms"), /text message/i);
assert.match(getReservationDeliverySpokenInstruction("email"), /email/i);

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
assert.match(payload.text, /RSV-430-MAYADA/);

console.log("reservation delivery routing regression passed");
