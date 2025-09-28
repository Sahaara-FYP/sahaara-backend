import express, {
  type Application,
  type Request,
  type Response,
} from "express";
import prisma from "./utils/prisma.ts";
import morgan from "morgan";
import supabase from "./utils/supabase.ts";
import { authRouter } from "./auth/auth.ts";

const app: Application = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(morgan("dev"));

//Test Routes
app.get("/", (req: Request, res: Response) => {
  res.json({ message: "Welcome to Sahaara API 🚀" });
});

app.use("/api/auth", authRouter);

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
