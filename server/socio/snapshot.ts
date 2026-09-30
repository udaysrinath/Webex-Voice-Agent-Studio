import { formatEventTime, getSocioConfig, htmlToText, resolveComponentIds, socioPaginate, type ComponentIds } from "./client";

export interface SnapshotSession {
  id: number;
  name: string;
  overview: string | null;
  startTime: number;
  endTime: number;
  region: { name: string } | null;
  tracks: Array<{ name: string }> | null;
  component: { name: string } | null;
  items: Array<{ id: number; name: string; componentId: number }> | null;
}
export interface SnapshotSpeaker { id: number; name: string; info: string | null; overview: string | null }
export interface SnapshotRoom { name: string; maxCapacity: number | null }

const SESSIONS_QUERY = `query($eventId:Int!,$first:Int,$cursor:String){
  sessionsConnection(eventId:$eventId, first:$first, after:$cursor){
    pageInfo{ endCursor hasNextPage }
    nodes{ id name overview startTime endTime region{ name } tracks{ name } component{ name } items{ id name componentId } }
  }
}`;
const SPEAKERS_QUERY = `query($eventId:Int!,$first:Int,$cursor:String,$componentId:Int){
  itemsConnection(eventId:$eventId, first:$first, after:$cursor, filterParams:{ componentId:$componentId }){
    pageInfo{ endCursor hasNextPage }
    nodes{ id name info overview }
  }
}`;

const ROOMS_QUERY = `query($eventId:Int!,$first:Int,$cursor:String){
  regionsConnection(eventId:$eventId, first:$first, after:$cursor){
    pageInfo{ endCursor hasNextPage }
    nodes{ name maxCapacity }
  }
}`;

const MAX_DESCRIPTION = 700;
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
const truncate = (text: string) => text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION).replace(/\s+\S*$/, "")}...` : text;
const frontmatter = (title: string, url: string) => `---\nurl: "${url}"\ntitle: "${title}"\n---\n`;

export function renderAgendaMarkdown(sessions: SnapshotSession[], ids: ComponentIds, timezone: string): string {
  const sorted = sessions.filter((session) => session.name?.trim())
    .sort((a, b) => a.startTime - b.startTime || a.name.localeCompare(b.name) || a.id - b.id);
  const lines = [
    frontmatter("WebexOne 2026 Live Agenda (Socio)", "https://www.webexone.com/agenda.html"),
    "# WebexOne 2026 session agenda with rooms",
    `Every session with its room, time, speakers and topics, from the official event platform. All times are ${timezone} local time.`,
    "",
  ];
  let currentDay = "";
  for (const session of sorted) {
    const day = formatEventTime(session.startTime, timezone, "day");
    if (day !== currentDay) { lines.push(`## ${day}`, ""); currentDay = day; }
    const items = session.items || [];
    const speakers = items.filter((item) => item.componentId === ids.speakers).map((item) => item.name);
    const topics = items.filter((item) => item.componentId === ids.topics).map((item) => item.name);
    const tracks = (session.tracks || []).map((track) => track.name);
    const description = truncate(htmlToText(session.overview));
    lines.push(
      `### ${session.name.trim()}`,
      `- When: ${formatEventTime(session.startTime, timezone, "full")} to ${formatEventTime(session.endTime, timezone, "time")}`,
      `- Room: ${session.region?.name || "Room to be announced"}`,
      ...(session.component?.name ? [`- Agenda type: ${session.component.name}`] : []),
      ...(tracks.length ? [`- Format: ${tracks.join(", ")}`] : []),
      ...(speakers.length ? [`- Speakers: ${speakers.join(", ")}`] : []),
      ...(topics.length ? [`- Topics: ${topics.join(", ")}`] : []),
      ...(description ? [`- Description: ${description}`] : []),
      "",
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderSpeakersMarkdown(speakers: SnapshotSpeaker[], sessions: SnapshotSession[], ids: ComponentIds, timezone: string): string {
  const sessionsBySpeaker = new Map<number, SnapshotSession[]>();
  for (const session of sessions) {
    for (const item of session.items || []) {
      if (item.componentId !== ids.speakers) continue;
      sessionsBySpeaker.set(item.id, [...(sessionsBySpeaker.get(item.id) || []), session]);
    }
  }
  const lines = [
    frontmatter("WebexOne 2026 Speakers and Their Sessions (Socio)", "https://www.webexone.com/speakers.html"),
    "# WebexOne 2026 speakers and the sessions and rooms they appear in",
    `Speaker titles and bios with each of their sessions, rooms and times, from the official event platform. All times are ${timezone} local time.`,
    "",
  ];
  for (const speaker of [...speakers].filter((item) => item.name?.trim()).sort(byName)) {
    const appearances = [...(sessionsBySpeaker.get(speaker.id) || [])].sort((a, b) => a.startTime - b.startTime);
    const bio = truncate(htmlToText(speaker.overview));
    lines.push(
      `### ${speaker.name.trim()}`,
      ...(speaker.info?.trim() ? [`- Title: ${htmlToText(speaker.info)}`] : []),
      ...(bio ? [`- Bio: ${bio}`] : []),
      ...(appearances.length
        ? [`- Sessions: ${appearances.map((session) => `${session.name.trim()} (${formatEventTime(session.startTime, timezone, "full")}, ${session.region?.name || "room to be announced"})`).join("; ")}`]
        : ["- Sessions: none listed yet"]),
      "",
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderRoomsMarkdown(rooms: SnapshotRoom[], sessions: SnapshotSession[], timezone: string): string {
  const sessionsByRoom = new Map<string, SnapshotSession[]>();
  for (const session of sessions) {
    if (!session.name?.trim() || !session.region?.name) continue;
    sessionsByRoom.set(session.region.name, [...(sessionsByRoom.get(session.region.name) || []), session]);
  }
  const names = new Set([...rooms.map((room) => room.name), ...sessionsByRoom.keys()]);
  const capacities = new Map(rooms.map((room) => [room.name, room.maxCapacity]));
  const lines = [
    frontmatter("WebexOne 2026 Rooms and Their Schedules (Socio)", "https://www.webexone.com/agenda.html"),
    "# WebexOne 2026 rooms and what is scheduled in each room",
    `Each room, level and venue space with its capacity when known and every session held there in time order. All times are ${timezone} local time.`,
    "",
  ];
  for (const name of [...names].sort((a, b) => a.localeCompare(b))) {
    const held = [...(sessionsByRoom.get(name) || [])].sort((a, b) => a.startTime - b.startTime || a.name.localeCompare(b.name));
    const capacity = capacities.get(name);
    lines.push(
      `### ${name.trim()}`,
      ...(capacity ? [`- Capacity: ${capacity}`] : []),
      ...(held.length
        ? held.map((session) => `- ${formatEventTime(session.startTime, timezone, "full")} to ${formatEventTime(session.endTime, timezone, "time")}: ${session.name.trim()}`)
        : ["- No sessions scheduled"]),
      "",
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export async function buildSocioSnapshot(): Promise<{ agenda: string; speakers: string; rooms: string; sessionCount: number; speakerCount: number; roomCount: number }> {
  const { timezone } = getSocioConfig();
  const ids = await resolveComponentIds();
  if (!ids.speakers) throw new Error('Could not find a component named "Speakers" for this event.');
  const [sessions, speakers, rooms] = await Promise.all([
    socioPaginate<{ sessionsConnection: any }, SnapshotSession>(SESSIONS_QUERY, (data) => data.sessionsConnection),
    socioPaginate<{ itemsConnection: any }, SnapshotSpeaker>(SPEAKERS_QUERY, (data) => data.itemsConnection, { componentId: ids.speakers }),
    socioPaginate<{ regionsConnection: any }, SnapshotRoom>(ROOMS_QUERY, (data) => data.regionsConnection),
  ]);
  return {
    agenda: renderAgendaMarkdown(sessions, ids, timezone),
    speakers: renderSpeakersMarkdown(speakers, sessions, ids, timezone),
    rooms: renderRoomsMarkdown(rooms, sessions, timezone),
    sessionCount: sessions.length,
    speakerCount: speakers.length,
    roomCount: rooms.length,
  };
}
