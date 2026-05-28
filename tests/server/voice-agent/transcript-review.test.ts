import assert from "node:assert/strict";

import {
  reviewEnglishUserTranscript,
  shouldSuppressBrowserUserTranscript,
  shouldSuppressTwilioUserTranscript,
} from "../../../server/voice-agent/index";

const originalApiKey = process.env.OPENAI_API_KEY;
const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;

try {
  process.env.OPENAI_API_KEY = "test-key";
  globalThis.fetch = (async () => new Response("upstream unavailable", { status: 500 })) as typeof fetch;

  const failedCorrectionResult = await reviewEnglishUserTranscript("Palo Alto", {
    agentName: "Store Assistant",
    lastAssistantTranscript: "The iPad mini is available at our Palo Alto store. I can have it ready for pickup tomorrow at 2 PM. Would that work?",
  });

  assert.deepEqual(failedCorrectionResult, {
    action: "keep",
    text: "Palo Alto",
  });

  delete process.env.OPENAI_API_KEY;
  const missingKeyResult = await reviewEnglishUserTranscript("iPad Air", {
    agentName: "Store Assistant",
    lastAssistantTranscript: "Which one would you like, the iPad Air or the iPad Pro?",
  });

  assert.deepEqual(missingKeyResult, {
    action: "keep",
    text: "iPad Air",
  });

  const localSuppressionResult = await reviewEnglishUserTranscript("morcelemoscrat", {
    agentName: "Store Assistant",
    lastAssistantTranscript: "How can I help you today?",
  });

  assert.deepEqual(localSuppressionResult, {
    action: "suppress",
    text: "",
  });

  const correctedNameResult = await reviewEnglishUserTranscript("Myata Abdulrahman.", {
    agentName: "Store Assistant",
    lastAssistantTranscript: "Got it. Based on your phone number, I found a profile. Can you confirm your first and last name?",
  });

  assert.deepEqual(correctedNameResult, {
    action: "replace",
    text: "Mayada Abdelrahman",
  });

  Date.now = () => 100_000;
  const assistantContext = {
    lastAssistantAudioAt: 99_000,
    lastAssistantDoneAt: 99_000,
    lastAssistantTranscript: "The iPad Air is available at our Palo Alto store.",
  };
  const constrainedAssistantContext = {
    ...assistantContext,
    lastAssistantTranscript: "Which one would you like, the iPad Air or the iPad Pro?",
  };

  const twilioEchoSuppressed = shouldSuppressTwilioUserTranscript("The iPad Air is available", {
    ...assistantContext,
    twilioResponseActive: true,
  });
  const browserEchoSuppressed = shouldSuppressBrowserUserTranscript("The iPad Air is available", {
    ...assistantContext,
    browserPlaybackActive: false,
    responseActive: true,
  });
  assert.equal(twilioEchoSuppressed, true);
  assert.equal(browserEchoSuppressed, twilioEchoSuppressed);

  const twilioShortAnswerSuppressed = shouldSuppressTwilioUserTranscript("iPad Air", {
    ...constrainedAssistantContext,
    twilioResponseActive: false,
  });
  const browserShortAnswerSuppressed = shouldSuppressBrowserUserTranscript("iPad Air", {
    ...constrainedAssistantContext,
    browserPlaybackActive: false,
    responseActive: false,
  });
  assert.equal(twilioShortAnswerSuppressed, false);
  assert.equal(browserShortAnswerSuppressed, twilioShortAnswerSuppressed);

  const twilioGreetingSuppressed = shouldSuppressTwilioUserTranscript("hello", {
    ...assistantContext,
    twilioResponseActive: true,
  });
  const browserGreetingSuppressed = shouldSuppressBrowserUserTranscript("hello", {
    ...assistantContext,
    browserPlaybackActive: true,
    responseActive: false,
  });
  assert.equal(twilioGreetingSuppressed, true);
  assert.equal(browserGreetingSuppressed, twilioGreetingSuppressed);

  const browserBiasedProductSuppressed = shouldSuppressBrowserUserTranscript(
    "Do you have the Bose QuietComfort 45 in stock?",
    {
      lastAssistantAudioAt: 99_900,
      lastAssistantDoneAt: 99_900,
      lastAssistantTranscript: "The Samsung Galaxy S25+ is available at our Palo Alto store.",
      browserPlaybackActive: true,
      responseActive: false,
    }
  );
  assert.equal(browserBiasedProductSuppressed, true);
} finally {
  if (originalApiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalApiKey;
  }
  globalThis.fetch = originalFetch;
  Date.now = originalDateNow;
}

console.log("transcript review fallback regression passed");
