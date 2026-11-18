// A minimal headless-Chrome driver over the DevTools protocol.
// No Playwright / Puppeteer: just Chrome and the `ws` package.

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import WebSocket from "ws";

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// ==========================================
// FINDING CHROME
// ==========================================

/** CHROME_PATH, else a well-known install, else
 *  something on PATH. */
export function findChrome(): string | null {

  const candidates: string[] = [];

  if (process.env.CHROME_PATH) {
    candidates.push(process.env.CHROME_PATH);
  }

  candidates.push(
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  );

  for (const name of [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser"
  ]) {

    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
      candidates.push(path.join(dir, name));
    }
  }

  return candidates.find((c) => c && fs.existsSync(c)) ?? null;
}

function freePort(): Promise<number> {

  return new Promise((resolve, reject) => {

    const server = net.createServer();

    server.listen(0, "127.0.0.1", () => {

      const { port } = server.address() as net.AddressInfo;

      server.close(() => resolve(port));
    });

    server.on("error", reject);
  });
}

// ==========================================
// BROWSER
// ==========================================

export interface LogEntry {
  type: string;
  text: string;
}

const KEY_CODES: Record<string, number> = {
  Space: 32,
  Enter: 13,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  KeyA: 65,
  KeyD: 68,
  KeyM: 77,
  KeyW: 87
};

export class Browser {

  readonly logs: LogEntry[] = [];

  private nextId = 0;

  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

  private constructor(
    private ws: WebSocket,
    private proc: ChildProcess,
    private profile: string
  ) {

    ws.on("message", (raw) => {

      const message = JSON.parse(String(raw));

      if (message.id && this.pending.has(message.id)) {

        const { resolve, reject } = this.pending.get(message.id)!;

        this.pending.delete(message.id);

        message.error
          ? reject(new Error(JSON.stringify(message.error)))
          : resolve(message.result);

      } else if (message.method === "Runtime.consoleAPICalled") {

        this.logs.push({
          type: message.params.type,
          text: message.params.args
            .map((a: any) => a.value ?? a.description ?? "")
            .join(" ")
        });

      } else if (message.method === "Runtime.exceptionThrown") {

        this.logs.push({
          type: "exception",
          text:
            message.params.exceptionDetails.exception?.description ??
            message.params.exceptionDetails.text
        });
      }
    });
  }

  static async launch(chromePath: string): Promise<Browser> {

    const port = await freePort();

    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "pico-chrome-"));

    const args = [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--autoplay-policy=no-user-gesture-required",
      "--window-size=900,700",
      "--disable-gpu",
      "--disable-dev-shm-usage"
    ];

    // Hosted CI runners need the sandbox off.
    if (process.env.CI) {
      args.push("--no-sandbox");
    }

    args.push("about:blank");

    const proc = spawn(chromePath, args, { stdio: "ignore" });

    let page: any;

    for (let i = 0; i < 100 && !page; i++) {

      try {

        const targets: any[] = await (
          await fetch(`http://127.0.0.1:${port}/json`)
        ).json();

        page = targets.find((t) => t.type === "page");

      } catch {
        // not up yet
      }

      if (!page) {
        await sleep(150);
      }
    }

    if (!page) {

      proc.kill();

      throw new Error("Chrome did not start");
    }

    const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });

    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });

    const browser = new Browser(ws, proc, profile);

    await browser.send("Page.enable");
    await browser.send("Runtime.enable");

    return browser;
  }

  send(method: string, params: object = {}): Promise<any> {

    return new Promise((resolve, reject) => {

      const id = ++this.nextId;

      this.pending.set(id, { resolve, reject });

      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async goto(url: string) {

    await this.send("Page.navigate", { url });

    await sleep(1500);
  }

  /** Evaluates an expression in the page. */
  async eval<T = any>(expression: string): Promise<T> {

    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });

    if (result.exceptionDetails) {

      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text
      );
    }

    return result.result.value;
  }

  async screenshot(file: string) {

    const { data } = await this.send("Page.captureScreenshot", { format: "png" });

    fs.writeFileSync(file, Buffer.from(data, "base64"));
  }

  async click(x: number, y: number) {

    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {

      await this.send("Input.dispatchMouseEvent", {
        type,
        x,
        y,
        button: "left",
        clickCount: 1
      });
    }
  }

  async key(code: string, key: string, down: boolean) {

    await this.send("Input.dispatchKeyEvent", {
      type: down ? "keyDown" : "keyUp",
      code,
      key,
      windowsVirtualKeyCode: KEY_CODES[code] ?? 0
    });
  }

  async tap(code: string, key: string, holdMs = 40) {

    await this.key(code, key, true);

    await sleep(holdMs);

    await this.key(code, key, false);
  }

  async close() {

    try {
      this.ws.close();
    } catch {
      // ignore
    }

    this.proc.kill();

    await sleep(300);

    try {
      fs.rmSync(this.profile, { recursive: true, force: true });
    } catch {
      // Chrome may still hold files briefly (Windows)
    }
  }
}
