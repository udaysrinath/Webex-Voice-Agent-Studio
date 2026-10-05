const DEFAULT_ENDPOINT = "https://public.api.socio.events/graphql";
const DEFAULT_TIMEZONE = "America/Chicago";
const MAX_CACHE_ENTRIES = 200;

export class SocioConfigError extends Error {}

export interface SocioConfig { apiKey: string; eventId: number; timezone: string; endpoint: string }

export function getSocioConfig(): SocioConfig {
  const apiKey = process.env.SOCIO_API_KEY?.trim();
  const eventId = Number(process.env.SOCIO_EVENT_ID);
  if (!apiKey || !Number.isInteger(eventId) || eventId <= 0) {
    throw new SocioConfigError("Socio is not configured. Set SOCIO_API_KEY and SOCIO_EVENT_ID in the server environment.");
  }
  return {
    apiKey,
    eventId,
    timezone: process.env.SOCIO_EVENT_TIMEZONE?.trim() || DEFAULT_TIMEZONE,
    endpoint: process.env.SOCIO_API_URL?.trim() || DEFAULT_ENDPOINT,
  };
}

export function isSocioConfigured(): boolean {
  try { getSocioConfig(); return true; } catch { return false; }
}

const cache = new Map<string, { expires: number; value: Promise<unknown> }>();

export function clearSocioCache(): void { cache.clear(); }

interface QueryOptions { ttlMs?: number; timeoutMs?: number }

export async function socioQuery<T>(query: string, variables: Record<string, unknown> = {}, options: QueryOptions = {}): Promise<T> {
  const { ttlMs = 0, timeoutMs = 6000 } = options;
  const config = getSocioConfig();
  const key = `${config.eventId}\n${query}\n${JSON.stringify(variables)}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (ttlMs > 0 && hit && hit.expires > now) return hit.value as Promise<T>;

  const request = (async () => {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.json().catch(() => null) as { data?: T; errors?: Array<{ message?: string }> } | null;
    if (!response.ok) throw new Error(`Socio request failed with HTTP ${response.status}.`);
    if (body?.errors?.length) throw new Error(`Socio query error: ${body.errors.map((error) => error.message).join("; ")}`);
    if (!body?.data) throw new Error("Socio returned an empty response.");
    return body.data;
  })();

  if (ttlMs > 0) {
    if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: now + ttlMs, value: request });
    request.catch(() => { if (cache.get(key)?.value === request) cache.delete(key); });
  }
  return request;
}

interface Connection<N> { pageInfo: { endCursor: string | null; hasNextPage: boolean }; nodes: N[] }

/** Follows cursor pagination. The query must declare $eventId, $first and $cursor. */
export async function socioPaginate<D, N>(
  query: string,
  extract: (data: D) => Connection<N>,
  variables: Record<string, unknown> = {},
  options: QueryOptions & { pageSize?: number; maxPages?: number } = {},
): Promise<N[]> {
  const { pageSize = 100, maxPages = 50, ...queryOptions } = options;
  const { eventId } = getSocioConfig();
  const nodes: N[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const connection: Connection<N> = extract(await socioQuery<D>(query, { ...variables, eventId, first: pageSize, cursor }, queryOptions));
    nodes.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage || !connection.pageInfo.endCursor) return nodes;
    cursor = connection.pageInfo.endCursor;
  }
  throw new Error(`Socio pagination exceeded ${maxPages} pages.`);
}

export interface ComponentIds { speakers?: number; topics?: number }

/** Component IDs differ per event, so resolve the ones we care about by name. */
export async function resolveComponentIds(): Promise<ComponentIds> {
  const { eventId } = getSocioConfig();
  const data = await socioQuery<{ componentsConnection: { nodes: Array<{ id: number; name: string }> } }>(
    "query($eventId:Int!){ componentsConnection(eventId:$eventId, first:100){ nodes{ id name } } }",
    { eventId },
    { ttlMs: 60 * 60_000 },
  );
  const byName = (name: string) => data.componentsConnection.nodes.find((component) => component.name.trim().toLowerCase() === name)?.id;
  return { speakers: byName("speakers"), topics: byName("topics") };
}

export function htmlToText(html: string | null | undefined): string {
  return (html || "")
    .replace(/<(?:br|\/p|\/div|\/li|\/h\d)\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ").trim();
}

export function formatEventTime(unixSeconds: number, timezone: string, style: "day" | "time" | "full"): string {
  const date = new Date(unixSeconds * 1000);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long", month: "long", day: "numeric" }).format(date);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date);
  return style === "day" ? day : style === "time" ? time : `${day}, ${time}`;
}
