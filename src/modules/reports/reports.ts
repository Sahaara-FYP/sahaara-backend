import { Router, Request, Response } from "express";
import { verifyAccessToken } from "../../middleware/verifyAccessToken.js";
import {
  ReportEntityType,
  ReportReason,
  ReportStatus,
} from "../../../generated/prisma/index.js";
import prisma from "../../utils/prisma.js";

const reportsRouter = Router();

/**
 * @api {post} /reports Create a Report
 * @apiName CreateReport
 * @apiGroup Reports
 * @apiPermission authenticated
 *
 * @apiHeader {String} Authorization Bearer token.
 *
 * @apiBody {String="request","offer","alert","user"} entityType Type of entity being reported.
 * @apiBody {String} entityId UUID of the entity.
 * @apiBody {String="spam","harassment","inappropriate_content","fraud","hate_speech","other"} reason Report reason.
 * @apiBody {String} [details] Additional details.
 * @apiBody {String} [reportedUserId] UUID of the user being reported (optional but recommended).
 */
reportsRouter.post(
  "/",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const reporterId = req.userId!;
      const { entityType, entityId, reason, details, reportedUserId } =
        req.body;

      // Validate inputs
      if (!entityType || !entityId || !reason) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Validate Enums manually if needed, or rely on Prisma/TS
      if (!Object.keys(ReportEntityType).includes(entityType)) {
        return res.status(400).json({ error: "Invalid entity type" });
      }
      if (!Object.keys(ReportReason).includes(reason)) {
        return res.status(400).json({ error: "Invalid report reason" });
      }

      // Prevent excessive reporting (simple rate limit logic could go here)

      // Create Report
      const report = await prisma.report.create({
        data: {
          reporterId,
          entityType: entityType as ReportEntityType,
          entityId,
          reason: reason as ReportReason,
          details,
          reportedUserId: reportedUserId || null,
          status: "pending",
        },
      });

      return res.status(201).json({
        message: "Report submitted successfully",
        report,
      });
    } catch (error) {
      console.error("Create report error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// --- Admin Endpoints ---

/**
 * @api {get} /reports List Reports (Admin)
 * @apiName ListReports
 * @apiGroup Reports
 * @apiPermission authenticated (admin)
 */
reportsRouter.get(
  "/",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      // TODO: Add Admin Check middleware here
      const { status, entityType, limit = "20", cursor } = req.query;

      const where: any = {};
      if (status) where.status = status as ReportStatus;
      if (entityType) where.entityType = entityType as ReportEntityType;

      const reports = await prisma.report.findMany({
        where,
        include: {
          reporter: {
            select: { id: true, fullName: true, username: true, email: true },
          },
          reportedUser: {
            select: { id: true, fullName: true, username: true, email: true },
          },
        },
        take: Number(limit),
        orderBy: { createdAt: "desc" },
      });

      return res.status(200).json({ data: reports });
    } catch (error) {
      console.error("List reports error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default reportsRouter;
