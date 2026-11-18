import {
  Client,
  Room
} from "@colyseus/sdk";

import {
  SERVER_HTTP_URL,
  SERVER_WS_URL
} from "../config";

import { tabSession } from "../net/session";

import { NET_SETTINGS } from "../net/settings";

// How many times the client library tries to
// get back into a room after the connection
// dropped. With its growing delay (0.2 s, 0.4 s,
// ... up to 5 s) ten attempts take about half a
// minute, which matches the 30 s the server
// holds a dropped player's seat.
export const RECONNECT_ATTEMPTS =
  NET_SETTINGS.reconnectAttempts;

/** Settings every joined room needs, and
 *  remembering it so a page reload can come
 *  back to it. */
export function prepareRoom(
  room: Room,
  roomCode?: string
) {

  room.reconnection.maxRetries =
    RECONNECT_ATTEMPTS;

  // Retry even if the connection fails soon
  // after joining.
  room.reconnection.minUptime = 0;

  tabSession.remember(
    room.reconnectionToken,
    roomCode
  );
}

export class NetworkManager {

  private client: Client;

  public room!: Room;

  constructor() {

    this.client =
      new Client(
        SERVER_WS_URL
      );
  }

  // ==========================================
  // CREATE ROOM
  // ==========================================

  async createRoom(): Promise<Room> {

    console.log(
      "Creating room..."
    );

    this.room =
      await this.client.create(
        "game"
      );

    prepareRoom(
      this.room
    );

    console.log(
      "Room created:",
      this.room.roomId
    );

    console.log(
      "Session ID:",
      this.room.sessionId
    );

    return this.room;
  }

  // ==========================================
  // FIND ROOM BY CODE
  // ==========================================

  async findRoomByCode(
    roomCode: string
  ): Promise<string> {

    const code =
      roomCode
        .trim()
        .toUpperCase();

    if (code.length !== 6) {
      throw new Error(
        "Room code must be exactly 6 characters."
      );
    }
    

    console.log(
      "Looking for room:",
      code
    );

    const response =
      await fetch(
        `${SERVER_HTTP_URL}/room/${code}`
      );

    if (!response.ok) {

      const data =
        await response
          .json()
          .catch(() => ({}));

      throw new Error(
        data.error ||
        "Room not found."
      );
    }

    const data =
      await response.json();

    console.log(
      "Room found:",
      data.roomId
    );

    return data.roomId;
  }

  // ==========================================
  // JOIN BY ROOM CODE
  // ==========================================

  async joinRoomByCode(
    roomCode: string
  ): Promise<Room> {

    const roomId =
      await this.findRoomByCode(
        roomCode
      );

    return this.joinRoomById(
      roomId
    );
  }

  // ==========================================
  // JOIN BY COLYSEUS ROOM ID
  // ==========================================

  async joinRoomById(
    roomId: string
  ): Promise<Room> {

    console.log(
      "Joining room:",
      roomId
    );

    this.room =
      await this.client.joinById(
        roomId
      );

    prepareRoom(
      this.room
    );

    console.log(
      "Joined room:",
      this.room.roomId
    );

    console.log(
      "Session ID:",
      this.room.sessionId
    );

    return this.room;
  }

  // ==========================================
  // RESUME (after a page reload)
  // ==========================================

  async resumeRoom(
    token: string
  ): Promise<Room> {

    console.log(
      "Resuming session..."
    );

    this.room =
      await this.client.reconnect(
        token
      );

    prepareRoom(
      this.room
    );

    console.log(
      "Resumed room:",
      this.room.roomId
    );

    return this.room;
  }

  // ==========================================
  // LEAVE
  // ==========================================

  async leaveRoom() {

    // Leaving on purpose: nothing to resume.
    tabSession.forget();

    if (!this.room) {
      return;
    }

    await this.room.leave();

    console.log(
      "Left room"
    );
  }
}