import * as fs from "node:fs";
import * as path from "node:path";
import { getSocioConfig, resolveComponentIds, socioPaginate } from "../server/socio/client";

// One-off export of the full, untruncated Socio data. The knowledge-base build (scripts/build-webexone-kb.ts)
// reads this frozen file, so the event data no longer depends on the live API.
const SESSIONS = `query($eventId:Int!,$first:Int,$cursor:String){
  sessionsConnection(eventId:$eventId, first:$first, after:$cursor){
    pageInfo{ endCursor hasNextPage }
    nodes{ id name overview startTime endTime region{ name } tracks{ name } component{ name } items{ id name componentId } }
  }
}`;
const SPEAKERS = `query($eventId:Int!,$first:Int,$cursor:String,$componentId:Int){
  itemsConnection(eventId:$eventId, first:$first, after:$cursor, filterParams:{ componentId:$componentId }){
    pageInfo{ endCursor hasNextPage }
    nodes{ id name info overview }
  }
}`;
const ROOMS = `query($eventId:Int!,$first:Int,$cursor:String){
  regionsConnection(eventId:$eventId, first:$first, after:$cursor){
    pageInfo{ endCursor hasNextPage }
    nodes{ name maxCapacity }
  }
}`;

async function main() {
  const { timezone, eventId } = getSocioConfig();
  const ids = await resolveComponentIds();
  if (!ids.speakers) throw new Error('No "Speakers" component found.');
  const [sessions, speakers, rooms] = await Promise.all([
    socioPaginate<{ sessionsConnection: any }, unknown>(SESSIONS, (data) => data.sessionsConnection),
    socioPaginate<{ itemsConnection: any }, unknown>(SPEAKERS, (data) => data.itemsConnection, { componentId: ids.speakers }),
    socioPaginate<{ regionsConnection: any }, unknown>(ROOMS, (data) => data.regionsConnection),
  ]);
  const out = path.resolve(process.cwd(), "server/data/webexone/raw/socio.json");
  fs.writeFileSync(out, JSON.stringify({ exportedAt: new Date().toISOString(), eventId, timezone, componentIds: ids, sessions, speakers, rooms }, null, 1));
  console.info(`Exported ${sessions.length} sessions, ${speakers.length} speakers, ${rooms.length} rooms to ${out}`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
