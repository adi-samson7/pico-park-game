// A TCP-ish proxy for tests: sits between the browser and the game server
// and makes the network behave badly on demand.
//
//   browser  <-->  LagProxy  <-->  game server
//
//   - oneWayMs / jitterMs   delay every WebSocket message (in order, like
//                           TCP: a late message holds up the ones behind it)
//   - dropAll()             kill every open WebSocket without a close
//                           handshake (what a dead Wi-Fi looks like)
//   - blocked = true        refuse new WebSocket connections (an outage)
//
// HTTP (the page itself, the matchmaking calls) is passed through
// unchanged.

import http from "node:http";
import type { AddressInfo } from "node:net";

import { WebSocket, WebSocketServer } from "ws";

interface Pair {
  client: WebSocket;
  upstream: WebSocket;
}

export class LagProxy {

  oneWayMs = 0;

  jitterMs = 0;

  /** While true, new WebSocket connections are refused. */
  blocked = false;

  readonly pairs = new Set<Pair>();

  private server: http.Server;

  private sockets = new WebSocketServer({ noServer: true });

  private lastDown = 0;

  private lastUp = 0;

  private random: () => number;

  private constructor(
    private readonly target: { host: string; port: number },
    seed: number
  ) {

    let state = seed;

    this.random = () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };

    this.server = http.createServer((req, res) => this.forward(req, res));

    this.server.on("upgrade", (req, socket, head) => {

      if (this.blocked) {
        socket.destroy();
        return;
      }

      this.sockets.handleUpgrade(req, socket, head, (client) =>
        this.relay(client, req.url ?? "/")
      );
    });
  }

  static async start(
    target: { host: string; port: number },
    seed = 1
  ): Promise<LagProxy> {

    const proxy = new LagProxy(target, seed);

    await new Promise<void>((resolve) =>
      proxy.server.listen(0, "127.0.0.1", resolve)
    );

    return proxy;
  }

  get port(): number {
    return (this.server.address() as AddressInfo).port;
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  // ---- HTTP ----

  private forward(req: http.IncomingMessage, res: http.ServerResponse) {

    const upstream = http.request(
      {
        host: this.target.host,
        port: this.target.port,
        method: req.method,
        path: req.url,
        headers: req.headers
      },
      (reply) => {
        res.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(res);
      }
    );

    upstream.on("error", () => {
      res.writeHead(502);
      res.end();
    });

    req.pipe(upstream);
  }

  // ---- WebSocket ----

  private delay(direction: "up" | "down"): number {

    const now = Date.now();

    const due = now + this.oneWayMs + this.random() * this.jitterMs;

    // In order: never deliver before something sent earlier.

    if (direction === "down") {
      this.lastDown = Math.max(this.lastDown, due);
      return this.lastDown - now;
    }

    this.lastUp = Math.max(this.lastUp, due);

    return this.lastUp - now;
  }

  private relay(client: WebSocket, path: string) {

    const upstream = new WebSocket(
      `ws://${this.target.host}:${this.target.port}${path}`
    );

    const pair: Pair = { client, upstream };

    this.pairs.add(pair);

    const backlog: { data: any; binary: boolean }[] = [];

    const pass = (
      from: WebSocket,
      to: WebSocket,
      direction: "up" | "down"
    ) => {

      from.on("message", (data, binary) => {

        const send = () => {

          if (to.readyState === WebSocket.OPEN) {
            to.send(data, { binary });
          } else if (to === upstream && to.readyState === WebSocket.CONNECTING) {
            backlog.push({ data, binary });
          }
        };

        const wait = this.delay(direction);

        wait > 0 ? setTimeout(send, wait) : send();
      });
    };

    pass(client, upstream, "up");
    pass(upstream, client, "down");

    upstream.on("open", () => {

      for (const { data, binary } of backlog) {
        upstream.send(data, { binary });
      }

      backlog.length = 0;
    });

    const closeBoth = (code: number, reason: Buffer, from: WebSocket) => {

      this.pairs.delete(pair);

      const other = from === client ? upstream : client;

      // Reserved codes (1005, 1006, ...) cannot be sent.

      const safe = code >= 1000 && code <= 4999 && ![1004, 1005, 1006, 1015].includes(code);

      try {

        if (other.readyState === WebSocket.OPEN) {
          safe ? other.close(code, reason) : other.close();
        } else if (other.readyState === WebSocket.CONNECTING) {
          other.terminate();
        }

      } catch {
        // already gone
      }
    };

    client.on("close", (code, reason) => closeBoth(code, reason, client));
    upstream.on("close", (code, reason) => closeBoth(code, reason, upstream));

    client.on("error", () => {});
    upstream.on("error", () => client.terminate());
  }

  /** Kills every open WebSocket the hard way (no close frame). */
  dropAll() {

    for (const pair of this.pairs) {

      pair.client.terminate();
      pair.upstream.terminate();
    }

    this.pairs.clear();
  }

  async close() {

    this.dropAll();

    this.sockets.close();

    this.server.closeAllConnections?.();

    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
