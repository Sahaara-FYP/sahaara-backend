import express, {
  type Application,
  type Request,
  type Response,
} from "express";
import morgan from "morgan";
import { authRouter } from "./modules/auth/auth.js";
import { fileURLToPath } from "url";
import path from "path";
import { requestsRouter } from "./modules/requests/requests.js";
import { alertsRouter } from "./modules/alerts/alerts.js";
import cors from "cors";
import { usersRouter } from "./modules/users/users.js";
import { analyticsRouter } from "./modules/analytics/analytics.js";
import prisma from "./utils/prisma.js";
import http from "http";
import { WebSocketServer } from "ws";
import { initWebsocket } from "./utils/ws.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app: Application = express();

const PORT = process.env.PORT || 5000;
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // Allow mobile apps/Postman
      callback(null, true); // Allow all origins dynamically
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(morgan("dev"));

//Test Routes
app.get("/", (req: Request, res: Response) => {
  res.json({ message: "Welcome to Sahaara API", success: true });
});

app.get("/api", (req: Request, res: Response) => {
  res.json({ message: "Welcome To Sahaara API", success: true });
});

app.use("/api/auth", authRouter);
app.use("/api/requests", requestsRouter);
app.use("/api/alerts", alertsRouter);
app.use("/api/users", usersRouter);
app.use("/api/analytics", analyticsRouter);

app.use("/api/docs", express.static(path.join(__dirname, "../apidoc")));

const server = http.createServer(app);

async function startServer() {
  try {
    // Test Supabase connection
    await prisma.$queryRaw`SELECT 1`;
    console.log("Supabase connection successful. Starting server...");

    initWebsocket(server);

    server.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to connect to Supabase:", err);
    process.exit(1); // Stop the process if connection fails
  }
}

startServer();
