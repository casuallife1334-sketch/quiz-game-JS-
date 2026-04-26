import test from "node:test";
import assert from "node:assert/strict";

import { buildChatMessage } from "./chatMessage.js";

test("buildChatMessage uses the actual room player as the message author", () => {
  const room = {
    players: [
      { id: "socket-1", name: "Alice", avatar: "alice.png" },
      { id: "socket-2", name: "Bob", avatar: "bob.png" },
    ],
  };

  const message = buildChatMessage(
    {
      id: "msg-1",
      roomId: "ROOM",
      text: " hello ",
      userId: "socket-2",
      username: "Mallory",
      avatar: "mallory.png",
      avatarColor: "red",
    },
    room,
    "socket-1",
    new Date("2026-01-02T03:04:00Z"),
    () => "03:04"
  );

  assert.deepEqual(message, {
    id: "msg-1",
    roomId: "ROOM",
    text: "hello",
    userId: "socket-1",
    username: "Alice",
    avatar: "alice.png",
    avatarColor: "hsl(273, 70%, 60%)",
    time: "03:04",
  });
});

test("buildChatMessage rejects empty text and unknown senders", () => {
  const room = { players: [{ id: "socket-1", name: "Alice", avatar: "" }] };

  assert.equal(
    buildChatMessage({ roomId: "ROOM", text: "   " }, room, "socket-1"),
    null
  );

  assert.equal(
    buildChatMessage({ roomId: "ROOM", text: "hello" }, room, "socket-9"),
    null
  );
});
