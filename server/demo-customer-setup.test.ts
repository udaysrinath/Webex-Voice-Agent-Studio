import assert from "node:assert/strict";

import { setupDemoCustomerSession } from "./demo-customer-setup";
import {
  getReservationConfirmationEmailTo,
  updateReservationDeliveryProfile,
} from "./voice-agent/reservation-delivery";

const originalWebhookUrl = process.env.DEMO_CONFIRMATION_EMAIL_WEBHOOK_URL;
updateReservationDeliveryProfile({ customerEmail: "" });

const noWebhookResult = setupDemoCustomerSession({
  customerEmail: " Customer@Example.com ",
});

assert.equal(noWebhookResult.success, true);
assert.equal(noWebhookResult.customerEmail, "customer@example.com");
assert.equal(noWebhookResult.emailConfigured, false);
assert.equal(getReservationConfirmationEmailTo(), "customer@example.com");

process.env.DEMO_CONFIRMATION_EMAIL_WEBHOOK_URL = "https://email.example.test/send";

const emailResult = setupDemoCustomerSession({
  customerEmail: " buyer@example.com ",
});

assert.equal(emailResult.success, true);
assert.equal(emailResult.customerEmail, "buyer@example.com");
assert.equal(emailResult.emailConfigured, true);
assert.equal(getReservationConfirmationEmailTo(), "buyer@example.com");

if (originalWebhookUrl === undefined) {
  delete process.env.DEMO_CONFIRMATION_EMAIL_WEBHOOK_URL;
} else {
  process.env.DEMO_CONFIRMATION_EMAIL_WEBHOOK_URL = originalWebhookUrl;
}
updateReservationDeliveryProfile({ customerEmail: "" });

console.log("Demo customer setup regression passed");
