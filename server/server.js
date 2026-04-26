import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import { buildChatMessage } from "./chatMessage.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || (process.env.NODE_ENV === 'production' ? 'https://qwalyyyy.popovichab.ru' : "http://localhost:5173");

app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: [CLIENT_URL, 'https://qwalyyyy.popovichab.ru'],
    methods: ["GET", "POST"],
    credentials: true
  },
  maxHttpBufferSize: 5e6
});

io.engine.on('connection_error', (err) => {
  console.log('[Server] Connection error:', err.req.headers.origin, err.message);
});

const rooms = {};

function isRoomMember(room, socketId) {
  return Boolean(room?.players?.some((p) => p.id === socketId));
}

function isRoomHost(room, socketId) {
  return Boolean(room && room.host === socketId);
}

function createTrainingState(categoryIndex, questionIndex) {
  return {
    questionKey: `${categoryIndex}-${questionIndex}`,
    slide: 0,
    playerAnswers: [],
    correctAnswer: null
  };
}

function createTrainingStateForRoom(room, questionKey) {
  const categoryIndex = room?.currentQuestion?.categoryIndex ?? 0;
  const questionIndex = room?.currentQuestion?.questionIndex ?? 0;
  return {
    questionKey: questionKey || `${categoryIndex}-${questionIndex}`,
    slide: 0,
    playerAnswers: [],
    correctAnswer: null
  };
}

function getQuestionPoints(room, question) {
  const rawPrice = Number(question?.price);
  const basePoints = Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : 100;
  const rawMultiplier = Number(room?.game?.modeSettings?.custom?.scoreMultiplier);
  const multiplier = Number.isFinite(rawMultiplier) && rawMultiplier > 0 ? rawMultiplier : 1;
  return Math.round(basePoints * multiplier);
}

function allNonHostPlayersAttempted(room) {
  if (!room?.currentQuestion) return false;
  const attempted = room.currentQuestion.attemptedAnswerers || {};
  const nonHostIds = (room.players || [])
    .map((p) => p.id)
    .filter((id) => id && id !== room.host);
  if (nonHostIds.length === 0) return true;
  return nonHostIds.every((id) => attempted[id]);
}

function emitRevealAnswerIfNeeded(roomId, room) {
  if (!room?.currentQuestion) return;
  // если никто больше не может ответить — сразу показываем ответ всем
  if (!allNonHostPlayersAttempted(room)) return;

  const q = room.currentQuestion.question;
  const attemptedIds = Object.keys(room.currentQuestion.attemptedAnswerers || {});

  // === FIX Bug 12: Отправляем attemptedPlayers чтобы клиенты синхронизировались ===
  io.to(roomId).emit("reveal-answer", {
    reason: "all_attempts_used",
    correctAnswer: q?.answer,
    attemptedPlayers: attemptedIds,
    activeAnswererId: room.currentQuestion.activeAnswererId,
    stoppedTimeLeft: room.currentQuestion.stoppedTimeLeft,
    timerPausedAt: room.currentQuestion.timerPausedAt
  });
}

function createRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function getRoomState(room) {
  return {
    players: room.players,
    host: room.host,
    game: room.game,
    usedQuestions: room.usedQuestions,
    scores: room.scores,
    currentQuestion: room.currentQuestion
  };
}

io.on("connection", (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  // Создание комнаты
  socket.on("create-room", ({ name, avatar }) => {
    const roomId = createRoomCode();
    console.log(`[Room] Creating room ${roomId} by ${socket.id}`);

    // Если сокет уже в комнате — выходим из неё
    if (socket.room && rooms[socket.room]) {
      const oldRoom = rooms[socket.room];
      oldRoom.players = oldRoom.players.filter(p => p.id !== socket.id);
      delete oldRoom.scores[socket.id];
      socket.leave(socket.room);
      console.log(`[Room] Removed ${socket.id} from old room ${socket.room}`);

      // Если старая комната пуста — удаляем
      if (oldRoom.players.length === 0) {
        delete rooms[socket.room];
        console.log(`[Room] Deleted empty room ${socket.room}`);
      } else {
        io.to(socket.room).emit("players-update", {
          players: oldRoom.players,
          host: oldRoom.host,
          roomId: socket.room
        });
      }
    }

    rooms[roomId] = {
      players: [{ id: socket.id, name, avatar: avatar || "" }],
      host: socket.id,
      game: null,
      usedQuestions: [],
      currentQuestion: null,
      scores: {} // Ведущий не имеет очков
    };

    socket.join(roomId);
    socket.room = roomId; // Сохраняем комнату для сокета

    // Отправляем создателю подтверждение
    socket.emit("room-created", { roomId });

    // Отправляем состояние ВСЕМ в комнате
    io.to(roomId).emit("players-update", {
      players: rooms[roomId].players,
      host: rooms[roomId].host,
      roomId
    });

    io.to(roomId).emit("game-state", {
      game: null,
      usedQuestions: [],
      scores: rooms[roomId].scores,
      players: rooms[roomId].players,
      host: rooms[roomId].host,
      gameMode: rooms[roomId].gameMode || "custom"
    });

    console.log(`[Room] ${roomId} created with host ${socket.id}`);
  });

  // Присоединение к комнате
  socket.on("join-room", ({ roomId, name, avatar }) => {
    console.log(`[Room] ${socket.id} trying to join ${roomId}`);

    const room = rooms[roomId];
    if (!room) {
      console.log(`[Room] ${roomId} not found`);
      socket.emit("error-room", { message: "Комната не найдена" });
      return;
    }

    // Если сокет уже в другой комнате — выходим
    if (socket.room && socket.room !== roomId && rooms[socket.room]) {
      const oldRoom = rooms[socket.room];
      oldRoom.players = oldRoom.players.filter(p => p.id !== socket.id);
      delete oldRoom.scores[socket.id];
      socket.leave(socket.room);
      console.log(`[Room] Removed ${socket.id} from old room ${socket.room}`);

      if (oldRoom.players.length === 0) {
        delete rooms[socket.room];
      } else {
        io.to(socket.room).emit("players-update", {
          players: oldRoom.players,
          host: oldRoom.host,
          roomId: socket.room
        });
      }
    }

    // Не добавляем дубликат
    if (room.players.find(p => p.id === socket.id)) {
      console.log(`[Room] ${socket.id} already in room ${roomId}`);
      socket.room = roomId;
      socket.join(roomId);
      socket.emit("players-update", {
        players: room.players,
        host: room.host,
        roomId
      });
      socket.emit("game-state", {
        game: room.game,
        usedQuestions: room.usedQuestions,
        scores: room.scores,
        players: room.players,
        host: room.host,
        gameMode: room.gameMode || "custom"
      });

      if (room.currentQuestion) {
        socket.emit("question-selected", {
          ...room.currentQuestion,
          trainingState: room.trainingState
        });
        socket.emit("question-sync-state", {
          attemptedPlayers: Object.keys(room.currentQuestion.attemptedAnswerers || {}),
          activeAnswererId: room.currentQuestion.activeAnswererId,
          stoppedTimeLeft: room.currentQuestion.stoppedTimeLeft,
          timerPausedAt: room.currentQuestion.timerPausedAt
        });
      }

      if (room.gameMode === "training" && room.trainingState) {
        socket.emit("training-sync-state", room.trainingState);
      }

      if (room.gameEnded) {
        socket.emit("game-ended", {
          scores: room.scores,
          players: room.players,
          gameMode: room.gameMode
        });
      }
      return;
    }

    // Добавляем игрока
    const player = { id: socket.id, name, avatar: avatar || "" };
    room.players.push(player);
    // Не добавляем очки для ведущего
    if (socket.id !== room.host) {
      room.scores[socket.id] = 0;
    }
    socket.join(roomId);
    socket.room = roomId; // Сохраняем комнату для сокета

    console.log(`[Room] ${name} joined ${roomId}. Players: ${room.players.length}`);

    // ОТПРАВЛЯЕМ СОСТОЯНИЕ ВСЕМ В КОМНАТЕ
    io.to(roomId).emit("players-update", {
      players: room.players,
      host: room.host,
      roomId
    });

    io.to(roomId).emit("game-state", {
      game: room.game,
      usedQuestions: room.usedQuestions,
      scores: room.scores,
      players: room.players,
      host: room.host,
      gameMode: room.gameMode || "custom"
    });

    // Если вопрос открыт - отправляем новому игроку
    if (room.currentQuestion) {
      socket.emit("question-selected", room.currentQuestion);

      // Отправляем полное состояние ответов игроков для синхронизации
      socket.emit("question-sync-state", {
        attemptedPlayers: Object.keys(room.currentQuestion.attemptedAnswerers || {}),
        activeAnswererId: room.currentQuestion.activeAnswererId,
        stoppedTimeLeft: room.currentQuestion.stoppedTimeLeft,
        timerPausedAt: room.currentQuestion.timerPausedAt
      });
      console.log(`[Room] Syncing question state to new player: ${socket.id}`);

      // Если режим обучения и есть состояние - отправляем
      if (room.gameMode === "training") {
        console.log(`[Training] Join-room sync: gameMode=training, trainingState=${JSON.stringify(room.trainingState)}`);
        if (room.trainingState) {
          socket.emit("training-sync-state", room.trainingState);
          console.log(`[Training] Syncing state to new player: slide ${room.trainingState.slide}, answers=${room.trainingState.playerAnswers?.length || 0}`);
        } else {
          console.log(`[Training] WARNING: trainingState is null for new player`);
        }
      }
    }

    // Если игра завершена - отправляем новому игроку
    if (room.gameEnded) {
      socket.emit("game-ended", {
        scores: room.scores,
        players: room.players,
        gameMode: room.gameMode
      });
      console.log(`[Room] Syncing game-end to new player: ${socket.id}`);
    }
  });

  // Событие присоединения (для переподключений)
  socket.on("join-room-event", ({ roomId }) => {
    if (roomId && rooms[roomId]) {
      console.log(`[Room] ${socket.id} rejoining ${roomId}`);
      socket.join(roomId);

      // Отправляем текущее состояние
      const room = rooms[roomId];
      socket.emit("game-state", {
        game: room.game,
        usedQuestions: room.usedQuestions,
        scores: room.scores,
        players: room.players,
        host: room.host,
        gameMode: room.gameMode || "custom"
      });

      if (room.currentQuestion) {
        socket.emit("question-selected", room.currentQuestion);

        // Отправляем полное состояние ответов игроков для синхронизации
        socket.emit("question-sync-state", {
          attemptedPlayers: Object.keys(room.currentQuestion.attemptedAnswerers || {}),
          activeAnswererId: room.currentQuestion.activeAnswererId,
          stoppedTimeLeft: room.currentQuestion.stoppedTimeLeft,
          timerPausedAt: room.currentQuestion.timerPausedAt
        });

        // Если режим обучения - отправляем состояние
        if (room.gameMode === "training" && room.trainingState) {
          socket.emit("training-sync-state", room.trainingState);
        }
      }

      // Если игра завершена - отправляем
      if (room.gameEnded) {
        socket.emit("game-ended", {
          scores: room.scores,
          players: room.players,
          gameMode: room.gameMode
        });
      }
    }
  });

  // Запрос состояния
  socket.on("request-state", ({ roomId }) => {
    console.log(`[Room] State requested for ${roomId}`);
    const room = rooms[roomId];
    if (!room) return;

    socket.emit("game-state", {
      game: room.game,
      usedQuestions: room.usedQuestions,
      scores: room.scores,
      players: room.players,
      host: room.host,
      gameMode: room.gameMode || "custom"
    });

    if (room.currentQuestion) {
      socket.emit("question-selected", room.currentQuestion);

      // Отправляем полное состояние ответов игроков для синхронизации
      socket.emit("question-sync-state", {
        attemptedPlayers: Object.keys(room.currentQuestion.attemptedAnswerers || {}),
        activeAnswererId: room.currentQuestion.activeAnswererId,
        stoppedTimeLeft: room.currentQuestion.stoppedTimeLeft,
        timerPausedAt: room.currentQuestion.timerPausedAt
      });
    }

    // Если игра завершена - отправляем
    if (room.gameEnded) {
      socket.emit("game-ended", {
        scores: room.scores,
        players: room.players,
        gameMode: room.gameMode
      });
    }
  });

  // Старт игры
  socket.on("start-game", ({ roomId, game, gameMode = "custom" }) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id) {
      console.log(`[Room] Unauthorized start-game by ${socket.id}`);
      return;
    }

    console.log(`[Room] Starting game in ${roomId} with mode: ${gameMode}`);

    room.game = game;
    room.usedQuestions = [];
    room.currentQuestion = null;
    room.gameMode = gameMode;
    room.gameEnded = false; // Сбрасываем флаг конца игры
    room.trainingState = null; // Сбрасываем состояние обучения

    // Сбрасываем очки (ведущий не имеет очков)
    room.scores = {};
    room.players.forEach(p => {
      if (p.id !== room.host) {
        room.scores[p.id] = 0;
      }
    });

    // ОТПРАВЛЯЕМ ВСЕМ
    io.to(roomId).emit("game-started", { game, gameMode });
    io.to(roomId).emit("score-update", { scores: room.scores });
  });

  // Выбор вопроса
  socket.on("select-question", ({ roomId, categoryIndex, price, question, questionIndex = 0 }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (!isRoomHost(room, socket.id)) {
      console.log(`[Room] Unauthorized select-question by ${socket.id} in ${roomId}`);
      return;
    }

    console.log(`[Room] Question selected: cat=${categoryIndex}, qIndex=${questionIndex}, price=${price}`);

    room.currentQuestion = {
      categoryIndex,
      price,
      question,
      questionIndex,
      timerStart: Date.now(),
      timerDuration: question?.time || 30,
      // синхро-старт озвучки (чуть в будущем, чтобы успели дойти пакеты)
      speechStart: Date.now() + 350,
      // Кто сейчас отвечает (кто нажал "Ответить" и получил 15 секунд)
      activeAnswererId: null,
      // Кто уже попытался ответить на этот вопрос (1 попытка на игрока)
      attemptedAnswerers: {},
      // Тайм-данные для паузы основного таймера
      stoppedTimeLeft: null,
      timerPausedAt: null
    };

    // Сбрасываем training state для нового вопроса
    if (room.gameMode === "training") {
      room.trainingState = createTrainingState(categoryIndex, questionIndex);
    } else {
      room.trainingState = null;
    }

    // ОТПРАВЛЯЕМ ВСЕМ В КОМНАТЕ
    io.to(roomId).emit("question-selected", {
      categoryIndex,
      price,
      question,
      questionIndex: room.currentQuestion.questionIndex,
      timerStart: room.currentQuestion.timerStart,
      timerDuration: room.currentQuestion.timerDuration,
      speechStart: room.currentQuestion.speechStart,
      trainingState: room.trainingState
    });
  });

  // Вопрос отвечен
  socket.on("question-used", ({ roomId, categoryIndex, price, questionIndex = 0, correctPlayerId = null }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (!isRoomHost(room, socket.id)) {
      console.log(`[Room] Unauthorized question-used by ${socket.id} in ${roomId}`);
      return;
    }

    console.log(`[Room] Question used: cat=${categoryIndex}, qIndex=${questionIndex}, correctPlayerId=${correctPlayerId}`);

    const key = `${categoryIndex}-${questionIndex}`;
    if (!room.usedQuestions.includes(key)) {
      room.usedQuestions.push(key);
    }
    room.currentQuestion = null;

    // Проверяем, все ли вопросы использованы
    const allQuestions = [];
    room.game?.categories?.forEach((cat, catIdx) => {
      cat.questions?.forEach((q, qIdx) => {
        allQuestions.push(`${catIdx}-${qIdx}`);
      });
    });

    const allUsed = allQuestions.length > 0 && allQuestions.every(q => room.usedQuestions.includes(q));

    // ОТПРАВЛЯЕМ ВСЕМ
    io.to(roomId).emit("question-marked-used", {
      categoryIndex,
      questionIndex,
      gameMode: room.gameMode,
      game: room.game, // Передаем игру для разблокировки следующего вопроса
      correctPlayerId // Передаем ID правильного игрока для разблокировки в режиме обучения
    });

    // Если все вопросы использованы - отправляем событие конца игры
    if (allUsed) {
      console.log(`[Room] All questions used in ${roomId}, ending game`);
      room.gameEnded = true; // Устанавливаем флаг для синхронизации новых игроков
      setTimeout(() => {
        io.to(roomId).emit("game-ended", {
          scores: room.scores,
          players: room.players,
          gameMode: room.gameMode
        });
      }, 1000);
    }
  });

  // Обновление счета
  socket.on("update-score", ({ roomId, playerId, points }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (!isRoomHost(room, socket.id)) {
      console.log(`[Room] Unauthorized update-score by ${socket.id} in ${roomId}`);
      return;
    }

    if (!room.scores[playerId]) {
      room.scores[playerId] = 0;
    }
    room.scores[playerId] += points;

    console.log(`[Room] Score update: ${playerId} +${points} = ${room.scores[playerId]}`);

    // ОТПРАВЛЯЕМ ВСЕМ
    io.to(roomId).emit("score-update", { scores: room.scores });
  });

  // Чат
  socket.on("chat-message", (msg) => {
    const room = rooms[msg?.roomId];
    if (room && isRoomMember(room, socket.id)) {
      const normalizedMessage = buildChatMessage(msg, room, socket.id);
      if (!normalizedMessage) {
        return;
      }

      io.to(msg.roomId).emit("chat-message", normalizedMessage);
    }
  });

  // Игрок хочет ответить
  socket.on("player-wants-answer", ({ roomId, playerId, playerName }) => {
    const room = rooms[roomId];
    if (!room || !room.currentQuestion) return;
    if (!isRoomMember(room, socket.id) || playerId !== socket.id || socket.id === room.host) return;

    console.log(`[Room] Player ${playerName} wants to answer`);

    // Одна попытка на вопрос
    if (room.currentQuestion.attemptedAnswerers?.[playerId]) {
      return;
    }

    // Разрешаем только первому (активному) отвечающему
    if (room.currentQuestion.activeAnswererId && room.currentQuestion.activeAnswererId !== playerId) {
      return;
    }

    if (!room.currentQuestion.activeAnswererId) {
      room.currentQuestion.activeAnswererId = playerId;
    }

    // Отправляем всем в комнате уведомление
    io.to(roomId).emit("player-answer-request", {
      playerId,
      playerName,
      timestamp: Date.now()
    });
  });

  // Пауза таймера (кто-то нажал "Ответить")
  socket.on("pause-timer", ({ roomId, playerId, playerName, timeLeft }) => {
    const room = rooms[roomId];
    if (!room || !room.currentQuestion) return;
    if (!isRoomMember(room, socket.id) || playerId !== socket.id || socket.id === room.host) return;

    // Если уже есть активный отвечающий — отклоняем
    if (room.currentQuestion.activeAnswererId && room.currentQuestion.activeAnswererId !== playerId) {
      socket.emit("player-answer-rejected", { playerId, reason: "another_player_answering" });
      return;
    }

    // Если игрок уже отвечал — отклоняем
    if (room.currentQuestion.attemptedAnswerers?.[playerId]) {
      socket.emit("player-answer-rejected", { playerId, reason: "already_attempted" });
      return;
    }

    // Устанавливаем активного отвечающего
    room.currentQuestion.activeAnswererId = playerId;

    // Помечаем как attempted
    if (!room.currentQuestion.attemptedAnswerers) room.currentQuestion.attemptedAnswerers = {};
    room.currentQuestion.attemptedAnswerers[playerId] = true;

    // Сохраняем время
    room.currentQuestion.stoppedTimeLeft = timeLeft;
    room.currentQuestion.timerPausedAt = Date.now();

    // Отправляем ВСЕМ
    io.to(roomId).emit("pause-timer", {
      playerId,
      playerName,
      timestamp: Date.now(),
      timeLeft,
      attemptedPlayers: Object.keys(room.currentQuestion.attemptedAnswerers)
    });

    // Отправляем уведомление всем
    io.to(roomId).emit("player-answer-request", {
      playerId,
      playerName,
      timestamp: Date.now()
    });
  });

  // Возобновление таймера (после неверного ответа) - больше не используется
  socket.on("resume-timer", ({ roomId, timeLeft }) => {
    console.log(`[Timer] resume-timer event received but deprecated, room ${roomId}`);
  });

  // Проверка ответа игрока
  socket.on("submit-player-answer", ({ roomId, playerId, playerName, answer }) => {
    const room = rooms[roomId];
    if (!room || !room.currentQuestion) return;
    if (!isRoomMember(room, socket.id) || playerId !== socket.id || socket.id === room.host) return;

    // Принимаем ответ только от активного отвечающего
    if (room.currentQuestion.activeAnswererId !== playerId) return;

    const question = room.currentQuestion.question;

    // Отправляем ответ ВСЕМ
    io.to(roomId).emit("player-answer-submitted", {
      playerId,
      playerName,
      answer,
      timestamp: Date.now()
    });
  });

  // Таймаут ответа (15 секунд истекли)
  socket.on("player-answer-timeout", ({ roomId, playerId, playerName }) => {
    const room = rooms[roomId];
    if (!room || !room.currentQuestion) return;
    if (!isRoomMember(room, socket.id) || playerId !== socket.id || socket.id === room.host) return;

    // Если таймаут не от активного отвечающего — игнорируем
    if (room.currentQuestion.activeAnswererId !== playerId) return;

    const question = room.currentQuestion.question;
    const points = 0;
    const stoppedTimeLeft = room.currentQuestion.stoppedTimeLeft;

    // Помечаем попытку как использованную
    if (!room.currentQuestion.attemptedAnswerers) room.currentQuestion.attemptedAnswerers = {};
    room.currentQuestion.attemptedAnswerers[playerId] = true;

    // Сбрасываем активного отвечающего, чтобы игроки могли снова отвечать
    room.currentQuestion.activeAnswererId = null;
    room.currentQuestion.timerPausedAt = null;

    // Подготавливаем новый timerStart для возобновления основного таймера
    const timerDuration = room.currentQuestion.timerDuration || 30;
    const resumedTimerStart =
      stoppedTimeLeft !== undefined && stoppedTimeLeft !== null
        ? Date.now() - ((timerDuration - stoppedTimeLeft) * 1000)
        : null;

    io.to(roomId).emit("player-answer-result", {
      playerId,
      playerName,
      isCorrect: false,
      correctAnswer: question?.answer,
      points,
      stoppedTimeLeft,
      resumedTimerStart,
      attemptedPlayers: Object.keys(room.currentQuestion.attemptedAnswerers || {})
    });

    // При таймауте проверяем, есть ли еще игроки
    const nonHostPlayers = room.players.filter(p => p.id !== room.host);
    const attemptedIds = Object.keys(room.currentQuestion.attemptedAnswerers || {});
    const canStillAnswer = nonHostPlayers.some(p => !attemptedIds.includes(p.id));

    if (!canStillAnswer && nonHostPlayers.length > 0) {
      // Все игроки уже ответили (или таймаут) — показываем ответ
      console.log(`[Room] All players answered/timed out in ${roomId}, revealing answer`);
      io.to(roomId).emit("reveal-answer", {
        reason: "timeout",
        attemptedPlayers: attemptedIds,
        activeAnswererId: room.currentQuestion.activeAnswererId,
        stoppedTimeLeft: room.currentQuestion.stoppedTimeLeft,
        timerPausedAt: room.currentQuestion.timerPausedAt
      });
    }
    // Иначе таймер возобновится для остальных игроков
  });

  // Ведущий проверяет ответ
  socket.on("verify-player-answer", ({ roomId, playerId, playerName, isCorrect }) => {
    const room = rooms[roomId];
    if (!room || !room.currentQuestion) return;

    // Проверка разрешена только хосту
    if (room.host !== socket.id) return;

    const question = room.currentQuestion.question;
    const points = getQuestionPoints(room, question);

    // Если правильно - начисляем очки (но не ведущему)
    if (isCorrect && room.host !== playerId) {
      if (!room.scores[playerId]) room.scores[playerId] = 0;
      room.scores[playerId] += points;
      io.to(roomId).emit("score-update", { scores: room.scores });
    } else if (!isCorrect && room.host !== playerId) {
      // Если неверно - вычитаем очки
      if (!room.scores[playerId]) room.scores[playerId] = 0;
      room.scores[playerId] -= points;
      io.to(roomId).emit("score-update", { scores: room.scores });
    }

    // Сбрасываем активного отвечающего
    room.currentQuestion.activeAnswererId = null;
    room.currentQuestion.timerPausedAt = null;

    // Проверяем, есть ли еще игроки
    const nonHostPlayers = room.players.filter(p => p.id !== room.host);
    const attemptedIds = Object.keys(room.currentQuestion.attemptedAnswerers || {});
    const canStillAnswer = nonHostPlayers.some(p => !attemptedIds.includes(p.id));

    console.log(`[Verify] isCorrect=${isCorrect}, nonHostPlayers=${nonHostPlayers.length}, attemptedIds=[${attemptedIds}], canStillAnswer=${canStillAnswer}`);

    // Отправляем результат всем
    io.to(roomId).emit("player-answer-result", {
      playerId,
      playerName,
      isCorrect,
      correctAnswer: question?.answer,
      points: isCorrect ? points : -points,
      stoppedTimeLeft: room.currentQuestion.stoppedTimeLeft,
      resumedTimerStart: canStillAnswer
        ? Date.now() - ((room.currentQuestion.timerDuration - room.currentQuestion.stoppedTimeLeft) * 1000)
        : null,
      attemptedPlayers: attemptedIds
    });

    // Если все ответили неправильно — показываем ответ
    if (!isCorrect && !canStillAnswer) {
      console.log(`[Verify] All players answered incorrectly, revealing answer. nonHostPlayers=${nonHostPlayers.length}`);
      io.to(roomId).emit("reveal-answer", {
        reason: "all_incorrect",
        attemptedPlayers: attemptedIds,
        stoppedTimeLeft: room.currentQuestion.stoppedTimeLeft,
        timerPausedAt: null
      });
    } else if (isCorrect) {
      // Кто-то ответил правильно — показываем ответ
      console.log(`[Verify] Correct answer, revealing answer`);
      io.to(roomId).emit("reveal-answer", {
        reason: "correct_answer",
        attemptedPlayers: attemptedIds,
        stoppedTimeLeft: room.currentQuestion.stoppedTimeLeft,
        timerPausedAt: null
      });
    } else {
      console.log(`[Verify] Incorrect, but ${nonHostPlayers.length - attemptedIds.length} players can still answer`);
    }
    // Если !isCorrect && canStillAnswer — таймер возобновится на клиентах
  });

  // Завершение игры ведущим
  socket.on("end-game", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.host !== socket.id) {
      console.log(`[Room] Unauthorized end-game by ${socket.id} in ${roomId}`);
      return;
    }

    console.log(`[Room] Host ${socket.id} ended game in ${roomId}`);
    
    room.gameEnded = true;
    room.currentQuestion = null;

    // Отправляем событие всем в комнате
    io.to(roomId).emit("host-end-game", {
      roomId,
      endedBy: socket.id,
      scores: room.scores,
      players: room.players,
      gameMode: room.gameMode
    });
  });

  // ===== ОБРАБОТЧИКИ ДЛЯ РЕЖИМА ОБУЧАЛКИ =====

  // Ведущий пропускает вступление для всех
  socket.on("training-skip-intro", ({ questionKey, slide }) => {
    const roomId = socket.room;
    console.log(`[Training] Skip intro received from host ${socket.id}, roomId: ${roomId}, slide: ${slide}`);
    
    if (!roomId) {
      console.log(`[Training] No roomId found for socket ${socket.id}`);
      return;
    }

    const room = rooms[roomId];
    if (!isRoomHost(room, socket.id)) {
      console.log(`[Training] Unauthorized skip intro by ${socket.id}`);
      return;
    }

    // Отправляем всем в комнате кроме ведущего (он уже переключил)
    socket.to(roomId).emit("training-skip-intro", { slide });

    // Сохраняем в training state
    room.trainingState = room.trainingState || createTrainingStateForRoom(room, questionKey);
    room.trainingState.slide = slide;
  });

  // Игрок отправляет ответ в обучалке
  socket.on("training-submit-answer", ({ questionKey, answer, timeTaken, playerName, isCorrect }) => {
    console.log(`[Training] Answer from ${playerName}: ${answer} (${timeTaken}s)`);

    // Сохраняем ответ в состоянии комнаты
    const room = rooms[socket.room];
    if (!room || !isRoomMember(room, socket.id) || socket.id === room.host) return;

    room.trainingState = room.trainingState || createTrainingStateForRoom(room, questionKey);
    if (room.trainingState) {
      if (!room.trainingState.playerAnswers.find(a => a.playerId === socket.id)) {
        room.trainingState.playerAnswers.push({
          playerId: socket.id,
          playerName,
          answer,
          timeTaken,
          isCorrect: null // null = не проверено ведущим
        });
      }
    }

    // Отправляем ответ ВСЕМ в комнате (включая отправителя и ведущего)
    io.to(socket.room).emit("training-player-answer", {
      playerId: socket.id,
      playerName,
      answer,
      timeTaken,
      isCorrect: null // Будет проверено ведущим
    });
  });

  // Ведущий проверяет ответ игрока в обучалке
  socket.on("training-verify-answer", ({ questionKey, playerId, isCorrect }) => {
    const roomId = socket.room;
    const room = rooms[roomId];
    if (!room) return;

    if (!isRoomHost(room, socket.id)) {
      console.log(`[Training] Unauthorized verify by ${socket.id}`);
      return;
    }

    console.log(`[Training] Answer verified: player ${playerId} - ${isCorrect ? 'CORRECT' : 'INCORRECT'}`);

    const question = room.currentQuestion?.question;
    const points = getQuestionPoints(room, question);

    // Обновляем в состоянии комнаты
    if (room.trainingState && room.trainingState.playerAnswers) {
      const answer = room.trainingState.playerAnswers.find(a => a.playerId === playerId);
      if (answer) {
        answer.isCorrect = isCorrect;
      }
    }

    if (isCorrect && room.host !== playerId) {
      if (room.scores[playerId] == null) room.scores[playerId] = 0;
      room.scores[playerId] += points;
      io.to(roomId).emit("score-update", { scores: room.scores });
    }

    // Синхронизируем со всеми игроками
    io.to(roomId).emit("training-answer-verified", {
      playerId,
      isCorrect,
      points: isCorrect ? points : 0
    });
  });

  // Ведущий показывает результат всем
  socket.on("training-show-result", ({ questionKey, correctAnswer, playerAnswers }) => {
    const roomId = socket.room;
    const room = rooms[roomId];
    if (!room) return;

    if (!isRoomHost(room, socket.id)) {
      console.log(`[Training] Unauthorized show result by ${socket.id}`);
      return;
    }

    console.log(`[Training] Showing result: ${playerAnswers.length} answers`);

    // Сохраняем состояние
    room.trainingState = room.trainingState || {};
    room.trainingState.slide = 2;
    room.trainingState.playerAnswers = playerAnswers;
    room.trainingState.correctAnswer = correctAnswer;

    // Отправляем всем игрокам
    io.to(roomId).emit("training-show-result", {
      correctAnswer,
      playerAnswers
    });
  });

  // Финальный экран игры (ведущий завершил последний вопрос)
  socket.on("training-game-end", ({ roomId }) => {
    const actualRoomId = socket.room || roomId;
    const room = rooms[actualRoomId];
    if (!isRoomHost(room, socket.id)) {
      console.log(`[Training] Unauthorized game end by ${socket.id}`);
      return;
    }

    console.log(`[Training] Game end triggered for room: ${actualRoomId}`);
    // Отправляем всем игрокам кроме ведущего
    socket.to(actualRoomId).emit("training-game-end");
  });

  // Ведущий переключает слайд всем
  socket.on("training-slide-change", ({ questionKey, slide }) => {
    const roomId = socket.room;
    const room = rooms[roomId];
    if (!room) return;

    if (!isRoomHost(room, socket.id)) {
      console.log(`[Training] Unauthorized slide change by ${socket.id}`);
      return;
    }

    console.log(`[Training] Slide change to: ${slide}`);

    // Сохраняем слайд
    room.trainingState = room.trainingState || createTrainingStateForRoom(room, questionKey);
    room.trainingState.slide = slide;

    // Отправляем всем игрокам
    socket.to(roomId).emit("training-slide-change", { slide });
  });

  // Отключение
  socket.on("disconnect", () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
    
    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (!room) continue;

      // Удаляем игрока
      room.players = room.players.filter(p => p.id !== socket.id);
      delete room.scores[socket.id];

      // Передаем хостство после удаления отключившегося сокета
      if (room.host === socket.id && room.players.length > 0) {
        room.host = room.players[0].id;
        delete room.scores[room.host];
        console.log(`[Room] Host transferred to ${room.host}`);
      }

      // Удаляем комнату если пусто
      if (room.players.length === 0) {
        console.log(`[Room] ${roomId} deleted (no players)`);
        delete rooms[roomId];
      } else {
        io.to(roomId).emit("players-update", {
          players: room.players,
          host: room.host,
          roomId
        });
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n🎮 Server started on port ${PORT}`);
  console.log(`📡 Waiting for connections...`);
  console.log(`🔗 Client URL: ${CLIENT_URL}\n`);
});
