import { Client, Room } from "@colyseus/sdk";

export class NetworkManager {

  private client: Client;

  public room!: Room;

  private lookupServer =
    "http://localhost:3000";

  constructor() {

    this.client =
      new Client(
        "ws://localhost:2567"
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

    return this.room;
  }

  // ==========================================
  // FIND ROOM BY CODE
  // ==========================================

  async findRoom(
    roomCode: string
  ): Promise<string> {

    const code =
      roomCode
        .trim()
        .toUpperCase();

    console.log(
      "Looking for room:",
      code
    );

    const response =
      await fetch(
        `${this.lookupServer}/room/${code}`
      );

    if (!response.ok) {

      const data =
        await response
          .json()
          .catch(
            () => ({})
          );

      throw new Error(
        data.error ||
        "Room not found"
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
  // JOIN ROOM BY CODE
  // ==========================================

  async joinRoomByCode(
    roomCode: string
  ): Promise<Room> {

    const roomId =
      await this.findRoom(
        roomCode
      );

    console.log(
      "Joining Colyseus room:",
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

    return this.room;
  }

  // ==========================================
  // LEAVE ROOM
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