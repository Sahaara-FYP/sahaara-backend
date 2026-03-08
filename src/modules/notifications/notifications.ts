import express, { type Request, type Response } from "express";
import prisma from "../../utils/prisma.js";
import { verifyAccessToken } from "../../middleware/verifyAccessToken.js";

export const notificationsRouter = express.Router();

/**
 * @api {get} /notifications Fetch User Notifications
 * @apiName GetNotifications
 * @apiGroup Notifications
 *
 * @apiHeader {String} Authorization Bearer token.
 *
 * @apiSuccess {Object[]} notifications List of user notifications.
 */
notificationsRouter.get(
  "/",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const notifications = await prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });

      return res.status(200).json({ notifications });
    } catch (error) {
      console.error("Fetch notifications error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * @api {get} /notifications/unread-count Fetch Unread Notification Count
 * @apiName GetUnreadNotificationCount
 * @apiGroup Notifications
 *
 * @apiHeader {String} Authorization Bearer token.
 *
 * @apiSuccess {Number} count Unread notification count.
 */
notificationsRouter.get(
  "/unread-count",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const count = await prisma.notification.count({
        where: { userId, read: false },
      });

      return res.status(200).json({ count });
    } catch (error) {
      console.error("Fetch unread count error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * @api {patch} /notifications/:id/read Mark Notification as Read
 * @apiName MarkNotificationRead
 * @apiGroup Notifications
 *
 * @apiHeader {String} Authorization Bearer token.
 * @apiParam {String} id Notification ID.
 *
 * @apiSuccess {String} message Success message.
 */
notificationsRouter.patch(
  "/:id/read",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      const { id } = req.params;

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const notification = await prisma.notification.findUnique({
        where: { id: id || "" },
      });

      if (!notification || notification.userId !== userId) {
        return res.status(404).json({ error: "Notification not found" });
      }

      await prisma.notification.update({
        where: { id: id || "" },
        data: { read: true },
      });

      return res.status(200).json({ message: "Notification marked as read" });
    } catch (error) {
      console.error("Mark notification read error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * @api {patch} /notifications/read-all Mark All Notifications as Read
 * @apiName MarkAllNotificationsRead
 * @apiGroup Notifications
 *
 * @apiHeader {String} Authorization Bearer token.
 *
 * @apiSuccess {String} message Success message.
 */
notificationsRouter.patch(
  "/read-all",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId;

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      await prisma.notification.updateMany({
        where: { userId, read: false },
        data: { read: true },
      });

      return res
        .status(200)
        .json({ message: "All notifications marked as read" });
    } catch (error) {
      console.error("Mark all notifications read error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * @api {post} /notifications/token Register Push Token
 * @apiName RegisterPushToken
 * @apiGroup Notifications
 *
 * @apiHeader {String} Authorization Bearer token.
 * @apiBody {String} token Expo Push Token.
 *
 * @apiSuccess {String} message Success message.
 */
notificationsRouter.post(
  "/token",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      const { token } = req.body;

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (!token) {
        return res.status(400).json({ error: "Token is required" });
      }

      await prisma.user.update({
        where: { id: userId },
        data: { pushToken: token },
      });

      return res.status(200).json({ message: "Token registered successfully" });
    } catch (error) {
      console.error("Register token error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);
