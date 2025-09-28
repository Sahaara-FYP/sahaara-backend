import express, {
  type Application,
  type Request,
  type Response,
} from "express";
import prisma from "./utils/prisma.ts";
import morgan from "morgan";
import supabase from "./utils/supabase.ts";

const app: Application = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(morgan("dev"));

//Test Routes
app.get("/", (req: Request, res: Response) => {
  res.json({ message: "Welcome to Sahaara API 🚀" });
});

app.post("/users", async (req: Request, res: Response) => {
  try {
    await prisma.user.create({
      data: { email: "ayyan@gmail.com", name: "ayyan" },
    });
    res.json({ message: "Inserted Successfully" });
  } catch (err) {
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.get("/users", async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      include: { posts: true },
    });
    const supUsers = await supabase.from("User").select("*");
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
