import type { Request } from "express";
import { getWebexProfile } from "./webex-profile";

export interface DemoRuntimeConfig {
  webexSpaceId: string;
  source: "runtime" | "profile" | "unset";
  updatedAt: number | null;
}

export interface DemoPreflightCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

let runtimeWebexSpaceId = "";
let runtimeUpdatedAt: number | null = null;

export function getDemoRuntimeConfigSnapshot(): DemoRuntimeConfig {
  const profile = getWebexProfile();
  const webexSpaceId = runtimeWebexSpaceId || profile.webexSpaceId || "";
  return {
    webexSpaceId,
    source: runtimeWebexSpaceId ? "runtime" : profile.webexSpaceId ? "profile" : "unset",
    updatedAt: runtimeUpdatedAt,
  };
}

export function updateDemoRuntimeConfig(input: { webexSpaceId?: string }): DemoRuntimeConfig {
  if (typeof input.webexSpaceId === "string") {
    runtimeWebexSpaceId = input.webexSpaceId.trim();
    runtimeUpdatedAt = Date.now();
  }
  return getDemoRuntimeConfigSnapshot();
}

export async function getDemoPreflight(req: Request): Promise<{
  ready: boolean;
  config: DemoRuntimeConfig;
  checks: DemoPreflightCheck[];
}> {
  const config = getDemoRuntimeConfigSnapshot();
  const profile = getWebexProfile();
  const baseUrl = getPublicBaseUrl(req);
  const checks: DemoPreflightCheck[] = [
    {
      id: "openai",
      label: "OpenAI API key",
      ok: Boolean(process.env.OPENAI_API_KEY),
      detail: process.env.OPENAI_API_KEY ? "Configured" : "OPENAI_API_KEY is missing",
    },
    {
      id: "twilio",
      label: "Twilio voice",
      ok: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER),
      detail: process.env.TWILIO_PHONE_NUMBER || "Twilio credentials or phone number missing",
    },
    {
      id: "public-url",
      label: "Public app URL",
      ok: Boolean(baseUrl),
      detail: baseUrl || "APP_BASE_URL or request host is unavailable",
    },
    {
      id: "webex-token",
      label: "Webex token",
      ok: Boolean(profile.bearerToken),
      detail: profile.bearerToken ? "Configured" : "WEBEX_ACCESS_TOKEN or runtime profile token missing",
    },
    {
      id: "webex-room",
      label: "Webex room",
      ok: Boolean(config.webexSpaceId),
      detail: config.webexSpaceId
        ? `Using ${config.source} room ${config.webexSpaceId}`
        : "No Webex room configured",
    },
  ];

  if (profile.bearerToken && config.webexSpaceId) {
    checks.push(await checkWebexRoomReachable(profile.bearerToken, config.webexSpaceId));
  }

  return {
    ready: checks.every((check) => check.ok),
    config,
    checks,
  };
}

function getPublicBaseUrl(req: Request): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/+$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "http";
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "";
  return host ? `${proto.split(",")[0]}://${host.split(",")[0]}` : "";
}

async function checkWebexRoomReachable(token: string, roomId: string): Promise<DemoPreflightCheck> {
  try {
    const response = await fetch(`https://webexapis.com/v1/rooms/${encodeURIComponent(roomId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return {
        id: "webex-room-live",
        label: "Webex room API",
        ok: false,
        detail: `Webex returned ${response.status} ${response.statusText}`,
      };
    }
    const room = await response.json() as { title?: string };
    return {
      id: "webex-room-live",
      label: "Webex room API",
      ok: true,
      detail: room.title ? `Room reachable: ${room.title}` : "Room reachable",
    };
  } catch (error: any) {
    return {
      id: "webex-room-live",
      label: "Webex room API",
      ok: false,
      detail: error?.message || "Webex room check failed",
    };
  }
}
