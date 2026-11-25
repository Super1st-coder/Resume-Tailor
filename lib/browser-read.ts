import { spawn } from "child_process";
import { existsSync, promises as fs } from "fs";
import os from "os";
import path from "path";
import { fromJsonLd, JobLinkError, JobPage, metaContent, resolvePublic } from "./job-link";

/**
 * Fallback for job sites that refuse plain HTTP readers: open the link in a hidden
 * Chrome (or Edge) on this server, let the page's JavaScript run, and read what a
 * visitor would see. Used only after the normal read was blocked.
 *
 * - Every request the browser makes (also redirects, frames, scripts) is checked:
 *   private / loopback addresses are refused, like the normal reader.
 * - One browser at a time (queued), a fresh temporary profile each time, killed after
 *   at most ~30 s.
 */

const NAV_TIMEOUT_MS = 30000;
const BLOCK_TITLE = /security checkpoint|just a moment|access denied|attention required|verify you are human|captcha|are you a robot|^error$/i;

function browserPath(): string | null {
  const env = process.env.CHROME_PATH?.trim();
  const candidates = [
    env,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google\\Chrome\\Application\\chrome.exe"),
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return (candidates.find((p) => p && existsSync(p)) as string | undefined) ?? null;
}

export function browserAvailable(): boolean {
  return typeof WebSocket !== "undefined" && browserPath() !== null;
}

// One browser at a time.
let queue: Promise<unknown> = Promise.resolve();

export function readJobPageWithBrowser(url: string): Promise<JobPage> {
  const run = queue.then(() => readOnce(url));
  queue = run.catch(() => undefined);
  return run;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readOnce(url: string): Promise<JobPage> {
  const exe = browserPath();
  if (!exe || typeof WebSocket === "undefined") throw new JobLinkError("No browser on the server", true);
  await resolvePublic(new URL(url)); // fail fast on private addresses

  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "rt-browser-"));
  const proc = spawn(
    exe,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-sync",
      "--disable-gpu",
      "--mute-audio",
      "--disable-breakpad",
      "--disable-crash-reporter",
      "--window-size=1280,900",
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: true }
  );
  const deadline = Date.now() + NAV_TIMEOUT_MS;
  let ws: WebSocket | null = null;
  let closeBrowser: (() => void) | null = null;

  try {
    // The browser writes its debugging port to DevToolsActivePort in the profile.
    let port = 0;
    while (!port && Date.now() < deadline) {
      await sleep(200);
      const f = await fs.readFile(path.join(profile, "DevToolsActivePort"), "utf8").catch(() => "");
      port = parseInt(f.split("\n")[0], 10) || 0;
    }
    if (!port) throw new Error("browser did not start");
    let wsUrl = "";
    while (!wsUrl && Date.now() < deadline) {
      const tabs = (await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => [])) as {
        type: string;
        webSocketDebuggerUrl: string;
      }[];
      wsUrl = tabs.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? "";
      if (!wsUrl) await sleep(200);
    }
    if (!wsUrl) throw new Error("browser has no page");

    ws = new WebSocket(wsUrl);
    await new Promise((ok, fail) => {
      ws!.onopen = ok;
      ws!.onerror = () => fail(new Error("browser connection failed"));
    });

    let nextId = 0;
    const pending = new Map<number, (r: { result?: Record<string, unknown>; error?: unknown }) => void>();
    const hostOk = new Map<string, Promise<boolean>>();
    let mainFrame = "";
    let docStatus = 0;

    const send = (method: string, params: Record<string, unknown> = {}) =>
      new Promise<Record<string, unknown>>((ok) => {
        const id = ++nextId;
        pending.set(id, (r) => ok(r.result ?? {}));
        ws!.send(JSON.stringify({ id, method, params }));
      });

    const allowed = (u: string): Promise<boolean> => {
      let parsed: URL;
      try {
        parsed = new URL(u);
      } catch {
        return Promise.resolve(false);
      }
      if (parsed.protocol === "data:" || parsed.protocol === "blob:") return Promise.resolve(true);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return Promise.resolve(false);
      const key = parsed.hostname;
      if (!hostOk.has(key)) hostOk.set(key, resolvePublic(parsed).then(() => true, () => false));
      return hostOk.get(key)!;
    };

    ws.onmessage = (m) => {
      const d = JSON.parse(String(m.data));
      if (d.id && pending.has(d.id)) {
        pending.get(d.id)!(d);
        pending.delete(d.id);
        return;
      }
      if (d.method === "Fetch.requestPaused") {
        const { requestId, request } = d.params;
        allowed(request.url).then((ok) =>
          ok
            ? send("Fetch.continueRequest", { requestId })
            : send("Fetch.failRequest", { requestId, errorReason: "AccessDenied" })
        );
      } else if (d.method === "Network.responseReceived" && d.params.type === "Document") {
        if (!mainFrame || d.params.frameId === mainFrame) docStatus = d.params.response.status;
      }
    };

    closeBrowser = () => {
      try {
        ws!.send(JSON.stringify({ id: ++nextId, method: "Browser.close" }));
      } catch {}
    };

    await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    await send("Network.enable");
    await send("Page.enable");
    const nav = await send("Page.navigate", { url });
    mainFrame = String(nav.frameId ?? "");

    // Wait until the page's text stops growing (JS-rendered pages, short challenges).
    const read = async () => {
      const r = await send("Runtime.evaluate", {
        expression: `JSON.stringify({ t: document.title, n: (document.body && document.body.innerText || "").length })`,
        returnByValue: true,
      });
      try {
        return JSON.parse(String((r.result as { value?: string })?.value ?? "{}")) as { t?: string; n?: number };
      } catch {
        return {};
      }
    };
    let last = -1;
    let stable = 0;
    const started = Date.now();
    await sleep(1500);
    while (Date.now() < deadline - 2000) {
      const s = await read();
      const n = s.n ?? 0;
      // Still on a bot checkpoint after 12 s: it won't let us through.
      if (BLOCK_TITLE.test(s.t ?? "") && Date.now() - started > 12000) break;
      if (n > 300 && !BLOCK_TITLE.test(s.t ?? "") && n === last) {
        if (++stable >= 2) break;
      } else stable = 0;
      last = n;
      await sleep(1000);
    }

    const r = await send("Runtime.evaluate", {
      expression: `JSON.stringify({ html: document.documentElement.outerHTML, text: document.body ? document.body.innerText : "", title: document.title, url: location.href })`,
      returnByValue: true,
    });
    const page = JSON.parse(String((r.result as { value?: string })?.value ?? "{}")) as {
      html?: string;
      text?: string;
      title?: string;
      url?: string;
    };
    const text = (page.text ?? "").replace(/\n{3,}/g, "\n\n").trim();
    const title = (page.title ?? "").trim();

    if (docStatus >= 400 || BLOCK_TITLE.test(title) || text.length < 300) {
      throw new JobLinkError(`This site doesn't allow automatic reading, even in a browser (HTTP ${docStatus || "?"}).`, true);
    }

    const html = page.html ?? "";
    const site = metaContent(html, "og:site_name");
    const metaDesc = metaContent(html, "og:description") || metaContent(html, "description");
    const pageText = [site && `Site name: ${site}`, title && `Page title: ${title}`, metaDesc && `Page summary: ${metaDesc}`, text]
      .filter(Boolean)
      .join("\n\n");
    // Embedded descriptions are often shortened here: the AI takes the full one from the page text.
    const ld = fromJsonLd(html);
    return { posting: { company: ld.company, role: ld.role }, pageText, finalUrl: page.url || url };
  } catch (e) {
    if (e instanceof JobLinkError) throw e;
    throw new JobLinkError("This site doesn't allow automatic reading.", true);
  } finally {
    // Close the browser and every helper process it started.
    closeBrowser?.();
    const exited = await Promise.race([
      new Promise<boolean>((ok) => (proc.exitCode !== null ? ok(true) : proc.once("exit", () => ok(true)))),
      sleep(3000).then(() => false),
    ]);
    try {
      ws?.close();
    } catch {}
    if (!exited || process.platform === "win32") {
      if (process.platform === "win32" && proc.pid) {
        await new Promise((ok) =>
          spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
            .on("exit", ok)
            .on("error", ok)
        );
      } else proc.kill("SIGKILL");
    }
    // Windows keeps the profile locked for a moment after the browser exits.
    for (let i = 0; i < 10; i++) {
      try {
        await fs.rm(profile, { recursive: true, force: true });
        break;
      } catch {
        await sleep(300);
      }
    }
  }
}
