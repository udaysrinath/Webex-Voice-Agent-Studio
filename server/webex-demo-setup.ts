import { getWebexProfile, updateWebexProfile, type WebexProfile } from "./webex-profile";

const WEBEX_API_BASE = "https://webexapis.com/v1";

export interface WebexDemoSessionInput {
  webexEmail: string;
}

export interface WebexDemoSessionResult {
  success: true;
  roomId: string;
  roomTitle: string;
  webexEmail: string;
  createdRoom: boolean;
  membershipStatus: "added" | "already_member";
  messageSent: boolean;
}

interface WebexRoom {
  id: string;
  title: string;
  type?: string;
}

interface WebexDemoSessionDependencies {
  fetchImpl?: typeof fetch;
  getProfile?: () => WebexProfile;
  updateProfile?: (update: WebexProfile) => WebexProfile;
}

export class WebexDemoSetupError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "WebexDemoSetupError";
    this.statusCode = statusCode;
  }
}

function normalizeWebexEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function buildDemoRoomTitle(webexEmail: string): string {
  return `Cisco Live Voice Agent Demo - ${normalizeWebexEmail(webexEmail)}`;
}

function webexHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json; charset=utf-8",
  };
}

async function readWebexError(response: Response): Promise<string> {
  const body = await response.text();
  if (!body) return response.statusText || "Webex request failed";

  try {
    const parsed = JSON.parse(body);
    return parsed.message || parsed.errors?.[0]?.description || response.statusText;
  } catch {
    return body;
  }
}

async function webexJson<T>(
  fetchImpl: typeof fetch,
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetchImpl(`${WEBEX_API_BASE}${path}`, {
    ...init,
    headers: {
      ...webexHeaders(token),
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const error = await readWebexError(response);
    throw new WebexDemoSetupError(`Webex API error (${response.status}): ${error}`, response.status);
  }

  return response.json() as Promise<T>;
}

async function findRoomByTitle(fetchImpl: typeof fetch, token: string, roomTitle: string): Promise<WebexRoom | null> {
  const params = new URLSearchParams({ max: "100" });
  const data = await webexJson<{ items?: WebexRoom[] }>(fetchImpl, token, `/rooms?${params.toString()}`, {
    method: "GET",
  });

  return data.items?.find((room) => room.title === roomTitle) || null;
}

async function createRoom(fetchImpl: typeof fetch, token: string, roomTitle: string): Promise<WebexRoom> {
  return webexJson<WebexRoom>(fetchImpl, token, "/rooms", {
    method: "POST",
    body: JSON.stringify({ title: roomTitle }),
  });
}

async function addMembership(
  fetchImpl: typeof fetch,
  token: string,
  roomId: string,
  webexEmail: string
): Promise<"added" | "already_member"> {
  const response = await fetchImpl(`${WEBEX_API_BASE}/memberships`, {
    method: "POST",
    headers: webexHeaders(token),
    body: JSON.stringify({
      roomId,
      personEmail: webexEmail,
    }),
  });

  if (response.ok) {
    return "added";
  }

  if (response.status === 409) {
    return "already_member";
  }

  const error = await readWebexError(response);
  throw new WebexDemoSetupError(`Webex membership error (${response.status}): ${error}`, response.status);
}

async function sendSetupMessage(
  fetchImpl: typeof fetch,
  token: string,
  roomId: string,
  webexEmail: string
): Promise<void> {
  const markdown = [
    "**Cisco Live voice agent demo room connected**",
    "",
    `Webex email: ${webexEmail}`,
    "Reservation confirmations and store-associate summaries will be posted here for this session.",
  ].join("\n");

  await webexJson(fetchImpl, token, "/messages", {
    method: "POST",
    body: JSON.stringify({
      roomId,
      markdown,
    }),
  });
}

export async function setupWebexDemoSession(
  input: WebexDemoSessionInput,
  dependencies: WebexDemoSessionDependencies = {}
): Promise<WebexDemoSessionResult> {
  const fetchImpl = dependencies.fetchImpl || fetch;
  const profile = (dependencies.getProfile || getWebexProfile)();
  const updateProfile = dependencies.updateProfile || updateWebexProfile;
  const token = profile.bearerToken;

  if (!token) {
    throw new WebexDemoSetupError(
      "Webex server token is not configured. Set WEBEX_ACCESS_TOKEN once in server secrets.",
      503
    );
  }

  const webexEmail = normalizeWebexEmail(input.webexEmail);
  const roomTitle = buildDemoRoomTitle(webexEmail);

  const existingRoom = await findRoomByTitle(fetchImpl, token, roomTitle);
  const room = existingRoom || await createRoom(fetchImpl, token, roomTitle);
  const membershipStatus = await addMembership(fetchImpl, token, room.id, webexEmail);

  updateProfile({ webexSpaceId: room.id });
  await sendSetupMessage(fetchImpl, token, room.id, webexEmail);

  return {
    success: true,
    roomId: room.id,
    roomTitle: room.title,
    webexEmail,
    createdRoom: !existingRoom,
    membershipStatus,
    messageSent: true,
  };
}
