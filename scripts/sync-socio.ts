import * as fs from "node:fs";
import * as path from "node:path";
import { buildSocioSnapshot } from "../server/socio/snapshot";

const directory = path.resolve(process.cwd(), "server/data/webexone");

function writeIfChanged(file: string, content: string): boolean {
  const target = path.join(directory, file);
  if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === content) return false;
  fs.writeFileSync(target, content);
  return true;
}

async function main() {
  const snapshot = await buildSocioSnapshot();
  if (snapshot.sessionCount === 0) throw new Error("Socio returned no sessions; refusing to overwrite the knowledge base.");
  const agendaChanged = writeIfChanged("socio-agenda.md", snapshot.agenda);
  const speakersChanged = writeIfChanged("socio-speakers.md", snapshot.speakers);
  const roomsChanged = writeIfChanged("socio-rooms.md", snapshot.rooms);
  const status = (changed: boolean) => changed ? "updated" : "unchanged";
  console.info(`Socio sync: ${snapshot.sessionCount} sessions (${status(agendaChanged)}), ${snapshot.speakerCount} speakers (${status(speakersChanged)}), ${snapshot.roomCount} rooms (${status(roomsChanged)}).`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
