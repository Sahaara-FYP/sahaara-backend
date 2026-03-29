import { Router, Request, Response } from "express";
import { verifyAccessToken } from "../../middleware/verifyAccessToken.js";
import { verifyRole } from "../../middleware/verifyRole.js";
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

      // Validate Enums
      if (!Object.keys(ReportEntityType).includes(entityType)) {
        return res.status(400).json({ error: "Invalid entity type" });
      }
      if (!Object.keys(ReportReason).includes(reason)) {
        return res.status(400).json({ error: "Invalid report reason" });
      }

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
 * @apiPermission admin
 *
 * @apiQuery {String} [status] Filter by report status (pending, reviewed, resolved, dismissed).
 * @apiQuery {String} [entityType] Filter by entity type (request, offer, alert, user).
 * @apiQuery {String} [reason] Filter by reason.
 * @apiQuery {Number} [limit=20] Number of results per page.
 * @apiQuery {Number} [offset=0] Offset for pagination.
 */
reportsRouter.get(
  "/",
  verifyAccessToken,
  verifyRole(["admin"]),
  async (req: Request, res: Response) => {
    try {
      const {
        status,
        entityType,
        reason,
        limit = "20",
        offset = "0",
      } = req.query;

      const limitNum = Math.max(1, Math.min(100, parseInt(limit as string, 10) || 20));
      const offsetNum = Math.max(0, parseInt(offset as string, 10) || 0);

      const where: any = {};
      if (status) where.status = status as ReportStatus;
      if (entityType) where.entityType = entityType as ReportEntityType;
      if (reason) where.reason = reason as ReportReason;

      const [reports, totalCount] = await Promise.all([
        prisma.report.findMany({
          where,
          include: {
            reporter: {
              select: {
                id: true,
                fullName: true,
                username: true,
                email: true,
                profilePictureUrl: true,
              },
            },
            reportedUser: {
              select: {
                id: true,
                fullName: true,
                username: true,
                email: true,
                profilePictureUrl: true,
                isActive: true,
              },
            },
          },
          take: limitNum,
          skip: offsetNum,
          orderBy: { createdAt: "desc" },
        }),
        prisma.report.count({ where }),
      ]);

      const totalPages = Math.ceil(totalCount / limitNum);
      const page = Math.floor(offsetNum / limitNum) + 1;

      return res.status(200).json({
        data: reports,
        pagination: {
          total: totalCount,
          page,
          limit: limitNum,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        message: "Reports fetched successfully",
      });
    } catch (error) {
      console.error("List reports error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * @api {patch} /reports/:id/action Take Action on a Report (Admin)
 * @apiName ActionReport
 * @apiGroup Reports
 * @apiPermission admin
 *
 * @apiParam {String} id Report ID.
 * @apiBody {String="reviewed","resolved","dismissed"} status New status for the report.
 * @apiBody {String} [adminNotes] Optional notes from admin.
 * @apiBody {Boolean} [blockUser] If true, deactivates the reported user.
 */
reportsRouter.patch(
  "/:id/action",
  verifyAccessToken,
  verifyRole(["admin"]),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status, adminNotes, blockUser } = req.body;

      if (!id) {
        return res.status(400).json({ error: "Report ID is required" });
      }

      if (status && !["reviewed", "resolved", "dismissed"].includes(status)) {
        return res.status(400).json({ error: "Invalid status value" });
      }

      const report = await prisma.report.findUnique({ where: { id } });
      if (!report) {
        return res.status(404).json({ error: "Report not found" });
      }

      // Update report atomically using transaction
      const result = await prisma.$transaction(async (tx) => {
        const updatedReport = await tx.report.update({
          where: { id },
          data: {
            ...(status && { status: status as ReportStatus }),
            ...(adminNotes !== undefined && { adminNotes }),
            ...(status === "resolved" || status === "dismissed"
              ? { resolvedAt: new Date() }
              : {}),
          },
          include: {
            reporter: {
              select: {
                id: true,
                fullName: true,
                username: true,
                email: true,
              },
            },
            reportedUser: {
              select: {
                id: true,
                fullName: true,
                username: true,
                email: true,
                isActive: true,
              },
            },
          },
        });

        // Optionally block (deactivate) the reported user
        if (blockUser && report.reportedUserId) {
          await tx.user.update({
            where: { id: report.reportedUserId },
            data: { isActive: false },
          });
        }

        return updatedReport;
      });

      return res.status(200).json({
        message: "Report action completed successfully",
        report: result,
      });
    } catch (error) {
      console.error("Report action error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default reportsRouter;
