#!/usr/bin/env node
/**
 * Start Resume Tailor: ONE server for every profile.
 *
 *   npm run start:all   -> uses the existing build
 *   npm run profiles    -> builds first, then starts
 *
 *   http://<server-ip>:<port>/        sign in; the username decides the profile
 *   http://<server-ip>:<port>/admin   admin page (admin password)
 *
 * Port: PORT (default 8000). Profiles are resumes/*.md; adding one (e.g. on the
 * admin page) needs no restart. The server is restarted if it crashes.
 */
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const port = Number(process.env.PORT) || 8000;
// Listen on every network interface so the app is reachable as http://<server-ip>:<port>.
const bindHost = process.env.BIND_HOST || "0.0.0.0";

/** Address shown to the user: PUBLIC_HOST if set, else this machine's own IPv4. */
function publicHost() {
  if (process.env.PUBLIC_HOST) return process.env.PUBLIC_HOST.trim();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254.")) return a.address;
    }
  }
  return "localhost";
}

const nextBin = require.resolve("next/dist/bin/next", { paths: [root] });

if (process.argv.includes("--build")) {
  console.log("Building…");
  const r = spawnSync(process.execPath, [nextBin, "build"], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status || 1);
} else if (!fs.existsSync(path.join(root, ".next", "BUILD_ID"))) {
  console.error('No build found. Run "npm run build" first (or "npm run profiles").');
  process.exit(1);
}

const host = publicHost();
console.log(`\n  Resume Tailor   http://${host}:${port}/`);
console.log(`  Admin page      http://${host}:${port}/admin\n`);
if (host !== process.env.PUBLIC_HOST) {
  console.log(`If ${host} is not the server's public IP, set PUBLIC_HOST=<public-ip> before starting.`);
}
console.log("Press Ctrl+C to stop.\n");

let child = null;
let shuttingDown = false;
let crashes = 0;
let startedAt = 0;

function start() {
  startedAt = Date.now();
  child = spawn(process.execPath, [nextBin, "start", "-H", bindHost, "-p", String(port)], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  child.on("exit", (code) => {
    if (shuttingDown) return;
    crashes = Date.now() - startedAt < 30000 ? crashes + 1 : 1;
    if (crashes > 5) {
      console.log(`Server crashed ${crashes} times in a row (code ${code}); giving up.`);
      process.exit(1);
    }
    console.log(`Server exited (code ${code}); restarting in 5s…`);
    setTimeout(start, 5000);
  });
}
start();

const stop = () => {
  shuttingDown = true;
  if (child && !child.killed) child.kill();
  setTimeout(() => process.exit(0), 500);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
