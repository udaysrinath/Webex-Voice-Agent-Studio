// Opens the avatar page in a headless Chrome with a fake microphone (a WAV file) over the DevTools protocol and prints its console.
// Real WebRTC behaviour that Node cannot reproduce. Usage: node scripts/drive-avatar-page.mjs <url> [micWav] [seconds]
// Read the app side from the server log: docker logs --since 1m webex-voice-agent-studio-app-1 | grep "live event"
// Drive Chrome over CDP: open the avatar page with a fake microphone and report console output and server-side timings.
import { spawn } from "node:child_process";
const [, , url, audioFile = "/tmp/silence.wav", seconds = "30", profile = "p"] = process.argv;
const port = 9300 + Math.floor(Math.random() * 100);
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/avatar-chrome-${port}`,
  "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${audioFile}`,
  "--autoplay-policy=no-user-gesture-required", "--window-size=1280,800", "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.find((t) => t.type === "page")) break; } catch {} await sleep(250); }
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
const t0 = Date.now(); const lines = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.method === "Runtime.consoleAPICalled") lines.push(`${((Date.now() - t0) / 1000).toFixed(1)}s console.${d.params.type}: ${d.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200)}`);
  if (d.method === "Runtime.exceptionThrown") lines.push(`${((Date.now() - t0) / 1000).toFixed(1)}s EXCEPTION ${d.params.exceptionDetails.exception?.description?.slice(0, 300)}`);
  if (d.method === "Log.entryAdded" && d.params.entry.level !== "verbose") lines.push(`${((Date.now() - t0) / 1000).toFixed(1)}s log.${d.params.entry.level}: ${d.params.entry.text.slice(0, 200)}`);
};
send("Runtime.enable"); send("Log.enable"); send("Page.enable");
send("Page.navigate", { url });
await sleep(Number(seconds) * 1000);
console.log(lines.join("\n") || "(no console output)");
ws.close(); chrome.kill("SIGKILL");
process.exit(0);
