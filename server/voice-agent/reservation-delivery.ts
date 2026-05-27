export type ReservationDeliveryChannel = "email" | "sms";
export type ReservationSpokenDeliveryRoute = "email" | "sms";

export interface RetailReservationForDelivery {
  customerName: string;
  itemName: string;
  itemDetails: string;
  store: string;
  pickupTime: string;
  reservationId: string;
}

interface ReservationDeliveryEnv {
  [key: string]: string | undefined;
}

interface ReservationDeliveryResult {
  success: boolean;
  result?: string;
  error?: string;
  data?: unknown;
  durationMs?: number;
}

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;
const DEFAULT_EMAIL_TIMEOUT_MS = 8000;

interface ReservationDeliveryRuntimeProfile {
  customerEmail?: string;
}

const runtimeProfile: ReservationDeliveryRuntimeProfile = {};

const EMAIL_TO_ENV_KEYS = [
  "CUSTOMER_CONFIRMATION_EMAIL",
  "DEMO_CUSTOMER_EMAIL",
  "DEMO_CONFIRMATION_EMAIL_TO",
];

const EMAIL_WEBHOOK_ENV_KEYS = [
  "DEMO_CONFIRMATION_EMAIL_WEBHOOK_URL",
  "DEMO_EMAIL_WEBHOOK_URL",
];

function firstConfiguredValue(env: ReservationDeliveryEnv, keys: string[]): string {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return "";
}

function normalizeEmail(email?: string): string | undefined {
  const trimmed = email?.trim().toLowerCase();
  return trimmed || undefined;
}

export function getReservationDeliveryProfile(): ReservationDeliveryRuntimeProfile {
  return { ...runtimeProfile };
}

export function updateReservationDeliveryProfile(
  update: ReservationDeliveryRuntimeProfile
): ReservationDeliveryRuntimeProfile {
  if (update.customerEmail !== undefined) {
    runtimeProfile.customerEmail = normalizeEmail(update.customerEmail);
  }
  return getReservationDeliveryProfile();
}

export function getReservationConfirmationEmailTo(
  env: ReservationDeliveryEnv = process.env
): string {
  if (runtimeProfile.customerEmail) return runtimeProfile.customerEmail;
  return firstConfiguredValue(env, EMAIL_TO_ENV_KEYS);
}

export function getReservationConfirmationEmailWebhookUrl(
  env: ReservationDeliveryEnv = process.env
): string {
  return firstConfiguredValue(env, EMAIL_WEBHOOK_ENV_KEYS);
}

export function isReservationEmailConfigured(
  env: ReservationDeliveryEnv = process.env
): boolean {
  return Boolean(
    getReservationConfirmationEmailTo(env) &&
    getReservationConfirmationEmailWebhookUrl(env)
  );
}

export function getReservationConfirmationEmailTimeoutMs(
  env: ReservationDeliveryEnv = process.env
): number {
  const configured = Number(env.DEMO_CONFIRMATION_EMAIL_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_EMAIL_TIMEOUT_MS;
}

export function resolveReservationDeliveryChannel(
  requestedChannel?: string
): ReservationDeliveryChannel {
  const requested = (requestedChannel || "").trim().toLowerCase();

  if (requested === "email") return "email";

  return "sms";
}

export function getDemoConfirmationChannel(): ReservationDeliveryChannel {
  return resolveReservationDeliveryChannel(process.env.DEMO_CONFIRMATION_CHANNEL);
}

export function getReservationDeliverySpokenInstruction(
  route: ReservationSpokenDeliveryRoute
): string {
  if (route === "sms") {
    return "After retail_reserve_item succeeds, your next spoken response must confirm the reservation and say that a confirmation will be sent by text message. Do not read out any reservation reference number or code.";
  }
  return "After retail_reserve_item succeeds, your next spoken response must confirm the reservation and say that a confirmation will be sent by email. Do not read out any reservation reference number or code.";
}

export function formatReservationConfirmationText(
  reservation: RetailReservationForDelivery
): string {
  return [
    "Reservation confirmed.",
    `Customer: ${reservation.customerName}`,
    `Item: ${reservation.itemName}`,
    `Pickup: ${reservation.store}, ${reservation.pickupTime}`,
    `Reference: ${reservation.reservationId}`,
  ].join("\n");
}

export function buildReservationConfirmationEmailPayload(
  reservation: RetailReservationForDelivery,
  env: ReservationDeliveryEnv = process.env
): Record<string, unknown> {
  const to = getReservationConfirmationEmailTo(env);
  const from = env.DEMO_CONFIRMATION_EMAIL_FROM?.trim();
  const subject = `Reservation confirmed: ${reservation.itemName}`;
  const text = formatReservationConfirmationText(reservation);

  return {
    ...(from ? { from } : {}),
    to,
    subject,
    text,
    reservation: {
      reservationId: reservation.reservationId,
      customerName: reservation.customerName,
      itemName: reservation.itemName,
      itemDetails: reservation.itemDetails,
      store: reservation.store,
      pickupTime: reservation.pickupTime,
    },
  };
}

export async function sendReservationConfirmationEmail(
  reservation: RetailReservationForDelivery,
  options: {
    env?: ReservationDeliveryEnv;
    fetchImpl?: FetchImpl;
  } = {}
): Promise<ReservationDeliveryResult> {
  const startedAt = Date.now();
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const to = getReservationConfirmationEmailTo(env);
  const url = getReservationConfirmationEmailWebhookUrl(env);

  if (!to || !url) {
    return {
      success: false,
      error: "Reservation email is not configured.",
      durationMs: Date.now() - startedAt,
      data: {
        deliveryChannel: "email",
        reservationId: reservation.reservationId,
      },
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    getReservationConfirmationEmailTimeoutMs(env)
  );

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(buildReservationConfirmationEmailPayload(reservation, env)),
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => "");
      return {
        success: false,
        error: `Reservation email failed with HTTP ${response.status}${responseText ? `: ${responseText}` : ""}`,
        durationMs: Date.now() - startedAt,
        data: {
          deliveryChannel: "email",
          to,
          reservationId: reservation.reservationId,
        },
      };
    }

    return {
      success: true,
      result: `Reservation confirmation email sent to ${to}.`,
      durationMs: Date.now() - startedAt,
      data: {
        deliveryChannel: "email",
        to,
        reservationId: reservation.reservationId,
      },
    };
  } catch (error: any) {
    const timedOut = error?.name === "AbortError";
    return {
      success: false,
      error: timedOut ? "Reservation email timed out." : error.message || "Reservation email failed.",
      durationMs: Date.now() - startedAt,
      data: {
        deliveryChannel: "email",
        to,
        reservationId: reservation.reservationId,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
