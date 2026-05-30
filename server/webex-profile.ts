export interface WebexProfile {
  bearerToken?: string;
  webexSpaceId?: string;
  demoCustomerPhone?: string;
}

const runtimeProfile: WebexProfile = {};

function normalizeBearerToken(token?: string): string | undefined {
  const trimmed = token?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^Bearer\s+/i, "").trim();
}

function normalizeSpaceId(spaceId?: string): string | undefined {
  const trimmed = spaceId?.trim();
  return trimmed || undefined;
}

function normalizePhone(phone?: string): string | undefined {
  const trimmed = phone?.trim();
  return trimmed || undefined;
}

export function getWebexProfile(): WebexProfile {
  return {
    bearerToken: runtimeProfile.bearerToken || normalizeBearerToken(process.env.WEBEX_ACCESS_TOKEN),
    webexSpaceId: runtimeProfile.webexSpaceId || normalizeSpaceId(process.env.WEBEX_SPACE_ID),
    demoCustomerPhone: runtimeProfile.demoCustomerPhone || normalizePhone(process.env.DEMO_CUSTOMER_PHONE),
  };
}

export function updateWebexProfile(update: WebexProfile): WebexProfile {
  if (update.bearerToken !== undefined) {
    runtimeProfile.bearerToken = normalizeBearerToken(update.bearerToken);
  }

  if (update.webexSpaceId !== undefined) {
    runtimeProfile.webexSpaceId = normalizeSpaceId(update.webexSpaceId);
  }

  if (update.demoCustomerPhone !== undefined) {
    runtimeProfile.demoCustomerPhone = normalizePhone(update.demoCustomerPhone);
  }

  return getWebexProfile();
}
