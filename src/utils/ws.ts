import WebSocket, { WebSocketServer, Server as WSServer } from "ws";

interface WSClient extends WebSocket {
  userId?: string;
}

let wss: WSServer;
const clients = new Set<WSClient>();

export function initWebsocket(server: any) {
  wss = new WebSocketServer({ server });

  wss.on("connection", (socket: WSClient, req) => {
    console.log("WebSocket client connected");

    const url = new URL(req.url!, `http://${req.headers.host}`);
    const userId = url.searchParams.get("userId");
    if (userId) socket.userId = userId;

    clients.add(socket);

    socket.on("close", () => {
      clients.delete(socket);
      console.log("WebSocket client disconnected");
    });
  });
}

export function broadcast(event: string, payload: any = {}) {
  const message = JSON.stringify({ event, payload });

  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

export function sendToUser(userId: string, event: string, payload: any = {}) {
  const message = JSON.stringify({ event, payload });

  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.userId === userId) {
      client.send(message);
    }
  });
}

export function sendToUsers(
  userIds: string[],
  event: string,
  payload: any = {}
) {
  const message = JSON.stringify({ event, payload });

  clients.forEach((client) => {
    if (
      client.readyState === WebSocket.OPEN &&
      client.userId &&
      userIds.includes(client.userId)
    ) {
      client.send(message);
    }
  });
}
