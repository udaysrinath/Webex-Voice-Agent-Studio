import {
  getReservationConfirmationEmailTo,
  isReservationEmailConfigured,
  updateReservationDeliveryProfile,
} from "./voice-agent/reservation-delivery";

export interface DemoCustomerSessionInput {
  customerEmail: string;
}

export interface DemoCustomerSessionResult {
  success: true;
  customerEmail: string;
  emailConfigured: boolean;
}

function normalizeCustomerEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function setupDemoCustomerSession(
  input: DemoCustomerSessionInput
): DemoCustomerSessionResult {
  const customerEmail = normalizeCustomerEmail(input.customerEmail);
  updateReservationDeliveryProfile({ customerEmail });

  const emailConfigured = isReservationEmailConfigured();
  return {
    success: true,
    customerEmail: getReservationConfirmationEmailTo(),
    emailConfigured,
  };
}
