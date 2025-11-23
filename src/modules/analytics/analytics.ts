import { Router } from "express";
import {
  averageFirstResponseTime,
  totalActiveAlerts,
  totalActiveRequests,
  totalCompletionRate,
  totalPendingVerifications,
  totalTrendData,
  totalUsers,
} from "./analytics.service.js";

export const analyticsRouter = Router();

analyticsRouter.get("/all", async (req, res) => {
  try {
    const activeRequests = await totalActiveRequests();
    const pendingVerifications = await totalPendingVerifications();
    const activeAlerts = await totalActiveAlerts();
    const users = await totalUsers();
    const avgFirstResponseTime = await averageFirstResponseTime();
    const completionRate = await totalCompletionRate();
    const trendData = await totalTrendData();

    res.json({
      activeRequests,
      pendingVerifications,
      activeAlerts,
      totalUsers: users,
      averageFirstResponseTime: avgFirstResponseTime,
      totalCompletionRate: completionRate,
      trendData,
    });
  } catch (error) {
    console.error("Error fetching dashboard analytics:", error);
    res.status(500).json({ error: "Failed to fetch dashboard analytics" });
  }
});
