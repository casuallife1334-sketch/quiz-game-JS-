import { useState, useEffect } from "react";
import { socket } from "../socket/socket";
import { Sparkles } from "lucide-react";
import "../styles/players-panel.css";

function getInitials(name) {
  if (!name) return "?";
  return name
    .split(/[\s.]+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function getAvatarColor(id) {
  if (!id) return "hsl(220,70%,55%)";
  let hash = 0;
  const str = String(id);
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue},70%,60%)`;
}

export default function PlayersPanel({ players, host, scores, isConnected, currentQuestion, gameMode }) {
  const [playerAnswers, setPlayerAnswers] = useState({});

  useEffect(() => {
    const handlePlayerAnswerSubmitted = (data) => {
      setPlayerAnswers((prev) => ({
        ...prev,
        [data.playerId]: {
          answer: data.answer,
          timestamp: Date.now(),
          playerName: data.playerName,
        },
      }));
    };

    const handleQuestionClosed = () => {
      setPlayerAnswers({});
    };

    socket.on("player-answer-submitted", handlePlayerAnswerSubmitted);
    socket.on("question-marked-used", handleQuestionClosed);
    socket.on("question-selected", handleQuestionClosed);
    socket.on("reveal-answer", handleQuestionClosed);

    return () => {
      socket.off("player-answer-submitted", handlePlayerAnswerSubmitted);
      socket.off("question-marked-used", handleQuestionClosed);
      socket.off("question-selected", handleQuestionClosed);
      socket.off("reveal-answer", handleQuestionClosed);
    };
  }, []);

  const gamePlayers = (players || []).filter((p) => p.id !== host);

  if (gamePlayers.length === 0) {
    return (
      <div className="pp-empty">
        <Sparkles size={32} strokeWidth={1.5} />
        <span>Ожидание игроков...</span>
      </div>
    );
  }

  const sortedPlayers = [...gamePlayers].sort((a, b) => {
    const scoreA = scores?.[a.id] || 0;
    const scoreB = scores?.[b.id] || 0;
    return scoreB - scoreA;
  });

  const topScore = sortedPlayers.length > 0
    ? Math.max(...sortedPlayers.map((p) => scores?.[p.id] || 0), 1)
    : 1;

  return (
    <div className="pp-root">
      <div className="pp-list">
        {sortedPlayers.map((player, index) => {
          const score = scores?.[player.id] || 0;
          const avatarUrl = player.avatar && String(player.avatar).trim();
          const displayName = player.name || `Игрок`;
          const percent = topScore > 0 ? (Math.max(0, score) / topScore) * 100 : 0;
          const hasAnswer = !!playerAnswers[player.id];

          return (
            <div
              key={player.id}
              className={`pp-card ${index === 0 && score > 0 ? "leader" : ""} ${hasAnswer ? "answered" : ""}`}
            >
              <div className="pp-card-inner">
                {/* Avatar */}
                <div className="pp-avatar-wrap">
                  <div
                    className="pp-avatar"
                    style={
                      !avatarUrl
                        ? { backgroundColor: getAvatarColor(player.id) }
                        : undefined
                    }
                  >
                    {avatarUrl ? (
                      <img src={avatarUrl} alt={displayName} />
                    ) : (
                      getInitials(displayName)
                    )}
                  </div>
                </div>

                {/* Info */}
                <div className="pp-info">
                  <span className="pp-name">{displayName}</span>
                  <span className={`pp-score ${score < 0 ? "negative" : ""}`}>{score} очков</span>
                </div>

                {/* Progress */}
                {score > 0 && (
                  <div className="pp-bar">
                    <div className="pp-bar-fill" style={{ width: `${percent}%` }} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
