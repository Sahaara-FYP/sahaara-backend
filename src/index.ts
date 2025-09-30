import express, {
  type Application,
  type Request,
  type Response,
} from "express";
import morgan from "morgan";
import { authRouter } from "./modules/auth/auth.ts";
import { fileURLToPath } from "url";
import path from "path";
import { requestsRouter } from "./modules/requests/requests.ts";
import { alertsRouter } from "./modules/alerts/alerts.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app: Application = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(morgan("dev"));

//Test Routes
app.get("/", (req: Request, res: Response) => {
  res.json({ message: "Welcome to Sahaara API 🚀" });
});

app.use("/api/auth", authRouter);
app.use("/api/requests", requestsRouter);
app.use("/api/alerts", alertsRouter);

app.use("/api/docs", express.static(path.join(__dirname, "../apidoc")));

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
