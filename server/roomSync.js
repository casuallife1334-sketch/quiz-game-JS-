export function buildGameStatePayload(room) {
  return {
    game: room.game,
    usedQuestions: room.usedQuestions,
    scores: room.scores,
    players: room.players,
    host: room.host,
    gameMode: room.gameMode || "custom",
  };
}

export function buildQuestionSyncPayload(currentQuestion) {
  return {
    attemptedPlayers: Object.keys(currentQuestion?.attemptedAnswerers || {}),
    activeAnswererId: currentQuestion?.activeAnswererId,
    stoppedTimeLeft: currentQuestion?.stoppedTimeLeft,
    timerPausedAt: currentQuestion?.timerPausedAt,
  };
}

export function buildReconnectPayload(room) {
  return {
    gameState: buildGameStatePayload(room),
    questionSelected: room.currentQuestion
      ? {
          ...room.currentQuestion,
          trainingState: room.trainingState || null,
        }
      : null,
    questionSyncState: room.currentQuestion
      ? buildQuestionSyncPayload(room.currentQuestion)
      : null,
    trainingSyncState:
      room.gameMode === "training" && room.trainingState ? room.trainingState : null,
    gameEnded: room.gameEnded
      ? {
          scores: room.scores,
          players: room.players,
          gameMode: room.gameMode,
        }
      : null,
  };
}
