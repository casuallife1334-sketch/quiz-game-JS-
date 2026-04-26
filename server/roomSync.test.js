import test from "node:test";
import assert from "node:assert/strict";

import { buildReconnectPayload } from "./roomSync.js";

test("buildReconnectPayload includes training sync state for in-progress training questions", () => {
  const room = {
    players: [
      { id: "host-1", name: "Host" },
      { id: "player-1", name: "Alice" },
    ],
    host: "host-1",
    game: { title: "Demo game" },
    usedQuestions: ["0-0"],
    scores: { "player-1": 200 },
    gameMode: "training",
    gameEnded: false,
    currentQuestion: {
      categoryIndex: 0,
      questionIndex: 1,
      price: 300,
      question: { text: "Question?" },
      attemptedAnswerers: { "player-1": true },
      activeAnswererId: "player-1",
      stoppedTimeLeft: 12,
      timerPausedAt: 123456,
    },
    trainingState: {
      questionKey: "0-1",
      slide: 2,
      playerAnswers: [{ playerId: "player-1", answer: "42", timeTaken: 5 }],
      correctAnswer: "42",
    },
  };

  const payload = buildReconnectPayload(room);

  assert.equal(payload.gameState.gameMode, "training");
  assert.deepEqual(payload.questionSyncState, {
    attemptedPlayers: ["player-1"],
    activeAnswererId: "player-1",
    stoppedTimeLeft: 12,
    timerPausedAt: 123456,
  });
  assert.equal(payload.questionSelected?.trainingState?.slide, 2);
  assert.deepEqual(payload.trainingSyncState, room.trainingState);
  assert.equal(payload.gameEnded, null);
});

test("buildReconnectPayload omits training sync for non-training rooms", () => {
  const room = {
    players: [{ id: "host-1", name: "Host" }],
    host: "host-1",
    game: null,
    usedQuestions: [],
    scores: {},
    gameMode: "custom",
    gameEnded: true,
    currentQuestion: null,
    trainingState: {
      questionKey: "0-0",
      slide: 3,
      playerAnswers: [],
      correctAnswer: "ok",
    },
  };

  const payload = buildReconnectPayload(room);

  assert.equal(payload.questionSelected, null);
  assert.equal(payload.questionSyncState, null);
  assert.equal(payload.trainingSyncState, null);
  assert.deepEqual(payload.gameEnded, {
    scores: {},
    players: room.players,
    gameMode: "custom",
  });
});
