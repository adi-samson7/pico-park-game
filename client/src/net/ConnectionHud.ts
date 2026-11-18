import Phaser from "phaser";

import type { Room } from "@colyseus/sdk";

import {
  LatencyMeter,
  QUALITY_COLORS,
  qualityOf
} from "./latency";

import { tabSession } from "./session";

// ==========================================
// CONNECTION HUD
// ==========================================
//
// What a scene shows about the network:
//
//   - a small "ping" chip (colour = quality)
//   - a veil with "CONNECTION LOST" while the
//     connection library tries to get back in
//   - the latency of every player (reported by
//     the server) for the scene to display
//
// and what it does for the player:
//
//   - measures the round trip and reports it
//   - remembers the new reconnection token
//     every time a connection is re-established
//     (so a page reload can resume the game)
//   - tells the scene when the room is gone
//     for good
//
// Both the lobby and the game scene use one;
// it removes all of its listeners when it is
// disposed because the room outlives scenes.

export interface ConnectionHudOptions {

  // Where the ping chip sits (bottom right
  // corner of the chip).
  x: number;
  y: number;

  // The room is gone for good (connection
  // lost and not recovered, or we left).
  onLost: (code: number) => void;

  // The connection came back.
  onRestored?: () => void;

  // The connection dropped.
  onDropped?: () => void;

  // New latencies of all players arrived.
  onLatencies?: () => void;
}

const PING_EVERY_MS = 2000;

export class ConnectionHud {

  readonly meter = new LatencyMeter();

  // Latest round-trip of every player (ms),
  // as measured by themselves.
  readonly rtts =
    new Map<string, number>();

  offline = false;

  private chip:
    Phaser.GameObjects.Text;

  private veil:
    Phaser.GameObjects.Rectangle;

  private message:
    Phaser.GameObjects.Text;

  private timers:
    Phaser.Time.TimerEvent[] = [];

  private disposed = false;

  private readonly handlers = {

    drop: () => this.handleDrop(),

    reconnect: () => this.handleReconnect(),

    leave: (code: number) => {

      if (!this.disposed) {
        this.options.onLost(code);
      }
    }
  };

  private offLatencies:
    (() => void) | null = null;

  constructor(
    private readonly scene:
      Phaser.Scene,

    private readonly room: Room,

    private readonly options:
      ConnectionHudOptions
  ) {

    this.chip =
      scene.add.text(
        options.x,
        options.y,
        "",
        {
          fontSize: "14px",
          color: "#ffffff"
        }
      )
        .setOrigin(1, 1)
        .setDepth(900);

    this.veil =
      scene.add.rectangle(
        400,
        300,
        800,
        600,
        0x000000,
        0.62
      )
        .setDepth(1000)
        .setVisible(false);

    this.message =
      scene.add.text(
        400,
        300,
        "",
        {
          fontSize: "30px",
          color: "#ffffff",
          align: "center",
          fontStyle: "bold",
          lineSpacing: 10
        }
      )
        .setOrigin(0.5)
        .setDepth(1001)
        .setVisible(false);

    room.onDrop(
      this.handlers.drop
    );

    room.onReconnect(
      this.handlers.reconnect
    );

    room.onLeave(
      this.handlers.leave
    );

    this.offLatencies =
      room.onMessage(
        "latencies",
        (
          data: {
            rtts?: Record<string, number>;
          }
        ) => {

          this.rtts.clear();

          for (
            const [id, rtt]
            of Object.entries(
              data?.rtts ?? {}
            )
          ) {

            this.rtts.set(
              id,
              Number(rtt)
            );
          }

          this.options.onLatencies?.();
        }
      );

    // The connection might already be down
    // when the scene starts.

    if (
      room.reconnection?.isReconnecting
    ) {
      this.handleDrop();
    }

    this.timers.push(
      scene.time.addEvent({
        delay: 300,
        callback: () => this.ping()
      }),

      scene.time.addEvent({
        delay: PING_EVERY_MS,
        loop: true,
        callback: () => this.ping()
      }),

      scene.time.addEvent({
        delay: 250,
        loop: true,
        callback: () => this.refresh()
      })
    );

    this.refresh();
  }

  // ========================================
  // PING
  // ========================================

  private ping() {

    if (
      this.disposed ||
      this.offline ||
      !this.room.connection?.isOpen
    ) {
      return;
    }

    this.room.ping(
      (ms: number) => {

        if (this.disposed) {
          return;
        }

        this.meter.add(ms);

        if (this.meter.rtt !== null) {

          this.room.send(
            "latency",
            { rtt: this.meter.rtt }
          );
        }

        this.refresh();
      }
    );
  }

  // ========================================
  // DROP / RECONNECT
  // ========================================

  private handleDrop() {

    if (this.disposed) {
      return;
    }

    const first = !this.offline;

    this.offline = true;

    this.meter.reset();

    this.refresh();

    if (first) {
      this.options.onDropped?.();
    }
  }

  private handleReconnect() {

    if (this.disposed) {
      return;
    }

    this.offline = false;

    // The token changes with every new
    // connection.

    tabSession.remember(
      this.room.reconnectionToken
    );

    // The first ping after reconnecting
    // should not wait for the next period.

    this.scene.time.delayedCall(
      200,
      () => this.ping()
    );

    this.refresh();

    this.options.onRestored?.();
  }

  // ========================================
  // DISPLAY
  // ========================================

  /** Round trip of a player, if known. */
  rttOf(id: string): number | null {

    if (id === this.room.sessionId) {
      return this.meter.rtt;
    }

    return this.rtts.get(id) ?? null;
  }

  private refresh() {

    if (this.disposed) {
      return;
    }

    const rtt = this.meter.rtt;

    const quality =
      this.offline
        ? "offline"
        : qualityOf(rtt);

    const color =
      "#" +
      QUALITY_COLORS[quality]
        .toString(16)
        .padStart(6, "0");

    this.chip.setColor(color);

    this.chip.setText(
      this.offline
        ? "● offline"
        : rtt === null
          ? "● …"
          : "● " + rtt + " ms"
    );

    this.veil.setVisible(this.offline);

    this.message.setVisible(this.offline);

    if (this.offline) {

      const retry =
        this.room.reconnection;

      this.message.setText(
        "CONNECTION LOST\n\nReconnecting…  (attempt " +
        Math.max(1, retry?.retryCount ?? 1) +
        " of " +
        (retry?.maxRetries ?? "?") +
        ")"
      );
    }
  }

  // ========================================
  // CLEAN UP
  // ========================================

  dispose() {

    if (this.disposed) {
      return;
    }

    this.disposed = true;

    this.room.onDrop.remove(
      this.handlers.drop
    );

    this.room.onReconnect.remove(
      this.handlers.reconnect
    );

    this.room.onLeave.remove(
      this.handlers.leave
    );

    this.offLatencies?.();

    for (const timer of this.timers) {
      timer.remove(false);
    }

    this.timers = [];

    this.chip.destroy();
    this.veil.destroy();
    this.message.destroy();
  }
}
