import { type Request, type Response, Router } from "express";
import { verifyAccessToken } from "../../middleware/verifyAccessToken.js";
import prisma from "../../utils/prisma.js";
import { sendToUsers } from "../../utils/ws.js";

export const chatRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /chat/rooms
// Returns all active chat rooms the authenticated user participates in.
// ─────────────────────────────────────────────────────────────────────────────
chatRouter.get(
  "/rooms",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    const userId = req.userId!;

    try {
      const rooms = await prisma.chatRoom.findMany({
        where: {
          status: "active",
          participants: { some: { userId } },
        },
        include: {
          participants: {
            include: {
              user: {
                select: { id: true, fullName: true, profilePictureUrl: true },
              },
            },
          },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { sender: { select: { id: true, fullName: true } } },
          },
          offer: { select: { id: true, title: true } },
          request: { select: { id: true, title: true } },
        },
        orderBy: { updatedAt: "desc" },
      });

      return res.json({ rooms });
    } catch (err) {
      console.error("GET /chat/rooms error:", err);
      return res.status(500).json({ error: "Failed to fetch chat rooms" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /chat/rooms/:roomId/messages
// Returns paginated messages for a specific room.
// ─────────────────────────────────────────────────────────────────────────────
chatRouter.get(
  "/rooms/:roomId/messages",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    const userId = req.userId!;
    const { roomId } = req.params;
    const cursor = req.query.cursor as string | undefined;
    const limit = Math.min(parseInt((req.query.limit as string) || "30"), 100);

    try {
      // Verify user is a participant in this room
      const participant = await prisma.chatParticipant.findUnique({
        where: { roomId_userId: { roomId, userId } },
      });

      if (!participant) {
        return res
          .status(403)
          .json({ error: "You are not a participant in this room" });
      }

      // Verify room is active
      const room = await prisma.chatRoom.findUnique({ where: { id: roomId } });
      if (!room || room.status !== "active") {
        return res
          .status(403)
          .json({ error: "This chat room is no longer active" });
      }

      const messages = await prisma.message.findMany({
        where: { roomId },
        include: {
          sender: {
            select: { id: true, fullName: true, profilePictureUrl: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      const nextCursor =
        messages.length === limit ? messages[messages.length - 1]?.id : null;

      return res.json({ messages: messages.reverse(), nextCursor });
    } catch (err) {
      console.error("GET /chat/rooms/:roomId/messages error:", err);
      return res.status(500).json({ error: "Failed to fetch messages" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /chat/rooms/:roomId/messages
// Saves a message and broadcasts it to all other participants via WebSocket.
// ─────────────────────────────────────────────────────────────────────────────
chatRouter.post(
  "/rooms/:roomId/messages",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    const userId = req.userId!;
    const { roomId } = req.params;
    const { content } = req.body;

    if (
      !content ||
      typeof content !== "string" ||
      content.trim().length === 0
    ) {
      return res.status(400).json({ error: "Message content is required" });
    }

    try {
      // Verify user is a participant and the room is active
      const [participant, room] = await Promise.all([
        prisma.chatParticipant.findUnique({
          where: { roomId_userId: { roomId, userId } },
        }),
        prisma.chatRoom.findUnique({ where: { id: roomId } }),
      ]);

      if (!participant) {
        return res
          .status(403)
          .json({ error: "You are not a participant in this room" });
      }

      if (!room || room.status !== "active") {
        return res
          .status(403)
          .json({ error: "This chat room is no longer active" });
      }

      // Save the message
      const message = await prisma.message.create({
        data: { roomId, senderId: userId, content: content.trim() },
        include: {
          sender: {
            select: { id: true, fullName: true, profilePictureUrl: true },
          },
        },
      });

      // Touch updatedAt on the room so inbox re-sorts correctly
      await prisma.chatRoom.update({
        where: { id: roomId },
        data: { updatedAt: new Date() },
      });

      // Broadcast to all OTHER participants in the room
      const otherParticipants = await prisma.chatParticipant.findMany({
        where: { roomId, userId: { not: userId } },
        select: { userId: true },
      });

      const targetUserIds = otherParticipants.map((p) => p.userId);
      if (targetUserIds.length > 0) {
        sendToUsers(targetUserIds, "new_message", { roomId, message });
      }

      return res.status(201).json({ message });
    } catch (err) {
      console.error("POST /chat/rooms/:roomId/messages error:", err);
      return res.status(500).json({ error: "Failed to send message" });
    }
  },
);
