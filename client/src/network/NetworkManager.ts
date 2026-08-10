import { Client, Room } from "@colyseus/sdk";

export class NetworkManager {

  private client: Client;

  public room!: Room;

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
  // JOIN ROOM
  // ==========================================

  async joinRoom(
    roomId?: string
  ): Promise<Room> {

    console.log(
      "Joining room..."
    );

    if (roomId) {

      this.room =
        await this.client.joinById(
          roomId
        );

    } else {

      this.room =
        await this.client.joinOrCreate(
          "game"
        );
    }

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