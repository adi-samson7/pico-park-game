import {
  Client,
  Room
} from "@colyseus/sdk";

import {
  SERVER_HTTP_URL,
  SERVER_WS_URL
} from "../config";

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
  // LEAVE
  // ==========================================

  async leaveRoom() {

    if (!this.room) {
      return;
    }

    await this.room.leave();

    console.log(
      "Left room"
    );
  }
}