import { Router } from "express";

export const authRouter = Router();

authRouter.get("/", async (req, res) => {
  res.json({ message: "Testing Auth Route" });
});
