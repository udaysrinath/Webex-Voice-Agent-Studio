import assert from "node:assert/strict";

import {
  getDemoCustomerProfile,
  getDemoRetailCustomer,
} from "../../server/voice-agent/dto";
import { buildOpenAIVoiceAgentInstructions } from "../../server/voice-agent/prompt";
import { profile_lookup } from "../../server/tools/retail";
import { resolveDemoSmsRecipientPhone } from "../../server/tools/twilio";

const previousName = process.env.DEMO_CUSTOMER_NAME;
const previousPhone = process.env.DEMO_CUSTOMER_PHONE;
const previousSmsRecipient = process.env.DEMO_SMS_RECIPIENT_PHONE;

try {
  delete process.env.DEMO_CUSTOMER_NAME;
  delete process.env.DEMO_CUSTOMER_PHONE;
  const defaultProfile = getDemoCustomerProfile();
  assert.equal(defaultProfile.name, "Mayada Abdelrahman");
  assert.equal(defaultProfile.firstName, "Mayada");
  assert.equal(defaultProfile.lastName, "Abdelrahman");

  process.env.DEMO_CUSTOMER_NAME = "Avery Chen";
  process.env.DEMO_CUSTOMER_PHONE = "+14155550199";
  delete process.env.DEMO_SMS_RECIPIENT_PHONE;

  const profile = getDemoCustomerProfile();
  assert.equal(profile.name, "Avery Chen");
  assert.equal(profile.firstName, "Avery");
  assert.equal(profile.lastName, "Chen");
  assert.equal(profile.phone, "+14155550199");

  const customer = getDemoRetailCustomer();
  assert.equal(customer.name, "Avery Chen");
  assert.equal(customer.phone, "+14155550199");
  assert.match(customer.relationshipContext, /Avery has shopped/);

  const profileLookup = await profile_lookup({});
  assert.equal(profileLookup.success, true);
  assert.equal((profileLookup.data as any).preferredName, "Avery");
  assert.equal((profileLookup.data as any).maskedFullName, "Avery C.");
  assert.match((profileLookup.data as any).confirmationPrompt, /profile for Avery/);

  assert.equal(resolveDemoSmsRecipientPhone(), "+14155550199");

  const runtimePrompt = buildOpenAIVoiceAgentInstructions({
    confirmationSpokenRoute: "sms",
    returningCallerName: "Avery",
  });
  assert.match(runtimePrompt, /Avery Chen/);
  assert.doesNotMatch(runtimePrompt, /John Rivera/);
} finally {
  if (previousName === undefined) {
    delete process.env.DEMO_CUSTOMER_NAME;
  } else {
    process.env.DEMO_CUSTOMER_NAME = previousName;
  }

  if (previousPhone === undefined) {
    delete process.env.DEMO_CUSTOMER_PHONE;
  } else {
    process.env.DEMO_CUSTOMER_PHONE = previousPhone;
  }

  if (previousSmsRecipient === undefined) {
    delete process.env.DEMO_SMS_RECIPIENT_PHONE;
  } else {
    process.env.DEMO_SMS_RECIPIENT_PHONE = previousSmsRecipient;
  }
}

console.log("demo customer env override regression passed");
