import { type Request, type Response, Router } from "express";
import { verifyAccessToken } from "../../middleware/verifyAccessToken.ts";
import prisma from "./../../utils/prisma.ts";

export const alertsRouter = Router();

alertsRouter.post(
  "/",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const {
        title,
        description,
        category,
        urgency_level,
        location_lat,
        location_lng,
      } = req.body;

      if (!title || !location_lat || !location_lng) {
        return res.status(400).json({
          error: "title, locationLat, and locationLng are required",
        });
      }

      const alert = await prisma.alert.create({
        data: {
          userId,
          title,
          description,
          category: category || "general",
          urgencyLevel: urgency_level || "normal",
          locationLat: location_lat,
          locationLng: location_lng,
        },
      });

      return res.status(201).json({
        message: "Alert posted successfully",
        alert,
      });
    } catch (error) {
      console.error("Error posting alert:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);
