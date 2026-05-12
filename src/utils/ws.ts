import WebSocket, { WebSocketServer, Server as WSServer } from "ws";

interface WSClient extends WebSocket {
  userId?: string;
  isAlive?: boolean;
}

let wss: WSServer;
const clients = new Set<WSClient>();

function heartbeat(this: WSClient) {
  this.isAlive = true;
}

export function initWebsocket(server: any) {
  wss = new WebSocketServer({ server });

  wss.on("connection", (socket: WSClient, req) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const userId = url.searchParams.get("userId");
    if (userId) socket.userId = userId;

    socket.isAlive = true;
    socket.on("pong", heartbeat);

    socket.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.event === "heartbeat") {
          socket.isAlive = true;
        }
      } catch (err) {
        // Not a JSON message or other error, ignore
      }
    });

    clients.add(socket);
    console.log(
      `WebSocket client ${userId} connected: Total clients now: ${clients.size}`,
    );

    socket.on("close", () => {
      clients.delete(socket);
      console.log(
        `WebSocket client ${userId} DISCONNECTED: Total clients now: ${clients.size}`,
      );
    });
  });

  const interval = setInterval(() => {
    wss.clients.forEach((ws: WSClient) => {
      if (ws.isAlive === false) {
        console.log(`Terminating inactive client: ${ws.userId}`);
        return ws.terminate();
      }

      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on("close", () => {
    clearInterval(interval);
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
  payload: any = {},
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
