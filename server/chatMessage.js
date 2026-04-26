function getAvatarColor(id = "") {
  let hash = 0;
  const source = String(id);

  for (let i = 0; i < source.length; i++) {
    hash = source.charCodeAt(i) + ((hash << 5) - hash);
  }

  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 60%)`;
}

export function formatChatTime(time) {
  return time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function buildChatMessage(payload, room, socketId, time = new Date(), formatTime = formatChatTime) {
  if (!payload?.roomId || !socketId || !room?.players?.length) {
    return null;
  }

  const player = room.players.find((candidate) => candidate.id === socketId);
  if (!player) {
    return null;
  }

  const text = String(payload.text || "").trim();
  if (!text) {
    return null;
  }

  return {
    id: payload.id || Date.now() + Math.random(),
    text,
    roomId: payload.roomId,
    userId: socketId,
    username: player.name || `User${String(socketId).slice(0, 6)}`,
    avatar: player.avatar || "",
    avatarColor: getAvatarColor(socketId),
    time: formatTime(time),
  };
}
