import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.PROD
  ? window.location.origin   // ← ВАЖНО
  : "http://localhost:3001";

export const socket = io(SOCKET_URL, {
  transports: ["websocket"], // можно оставить только websocket
  withCredentials: true,
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});