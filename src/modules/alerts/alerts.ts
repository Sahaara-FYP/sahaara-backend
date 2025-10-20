import { type Request, type Response, Router } from "express";
import { verifyAccessToken } from "../../middleware/verifyAccessToken.js";
import prisma from "./../../utils/prisma.js";
import upload from "../../middleware/multer.js";
import { Prisma } from "../../../generated/prisma/index.js";
import supabase from "./../../utils/supabase.js";
import { createSignedUrls } from "../../utils/createSignedURL.js";
import { keysToCamel } from "../../utils/camelize.js";
import { verifyRole } from "../../middleware/verifyRole.js";

export const alertsRouter = Router();

/**
 * @api {post} /alerts Create a new Alert
 * @apiName CreateAlert
 * @apiGroup Alerts
 *
 * @apiHeader {String} Authorization Bearer access token.
 *
 * @apiBody {String} title                 Title of the alert (required).
 * @apiBody {String} [description]         Detailed description of the alert.
 * @apiBody {String} [category="general"]  Category of the alert.
 * @apiBody {String="normal","high","low"} [urgencyLevel="normal"] Urgency level.
 * @apiBody {Number} locationLat          Latitude of the alert location (required).
 * @apiBody {Number} locationLng          Longitude of the alert location (required).
 * @apiBody {File[]} [attachments]         Optional file attachments (multipart formdata).
 *
 */
alertsRouter.post(
  "/",
  verifyAccessToken,
  upload.array("attachments"),
  async (req: Request, res: Response) => {
    const userId = req.userId!;
    const {
      title,
      description,
      category,
      urgencyLevel,
      locationLat,
      locationLng,
    } = req.body || {};

    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }
    if (!locationLat || !locationLng) {
      return res.status(400).json({ error: "Location is required" });
    }

    try {
      const newAlert = await prisma.$transaction(async (tx) => {
        let alert = await tx.alert.create({
          data: {
            userId,
            title,
            description,
            category,
            urgencyLevel,
            locationLat: parseFloat(locationLat),
            locationLng: parseFloat(locationLng),
            attachments: [],
          },
        });

        const attachments: string[] = [];

        if (req.files && Array.isArray(req.files)) {
          for (const file of req.files as Express.Multer.File[]) {
            const safeName = file.originalname.replace(/\s+/g, "_");
            const filePath = `alerts/${alert.id}/${Date.now()}_${safeName}`;

            const { data, error } = await supabase.storage
              .from("attachments")
              .upload(filePath, file.buffer, {
                cacheControl: "3600",
                upsert: false,
              });

            if (error) {
              console.error("Supabase upload error:", error);
              continue;
            }
            attachments.push(data.path);
          }
        }

        if (attachments.length > 0) {
          alert = await tx.alert.update({
            where: { id: alert.id },
            data: { attachments: attachments as Prisma.InputJsonValue },
          });
        }

        return alert;
      });

      return res.status(201).json({
        message: "Alert created successfully",
        alert: newAlert,
      });
    } catch (error) {
      console.error("Create alert error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * @api {get} /alerts Get Nearby Alerts
 * @apiName GetAlerts
 * @apiGroup Alerts
 * @apiPermission authenticated
 *
 * @apiHeader {String} Authorization Bearer token (JWT Access Token).
 *
 * @apiQuery {String} [locationLat] Latitude of current location (required for user).
 * @apiQuery {String} [locationLng] Longitude of current location (required for user).
 * @apiQuery {Number} [radius] Search radius in meters (optional).
 * @apiQuery {String} [category] Filter by alert category.
 * @apiQuery {String=normal,high,low} [urgencyLevel] Filter by urgency level.
 * @apiQuery {String=active,cancelled,resolved} [status] Filter by alert status.
 * @apiQuery {String=clean,flagged,reviewed,blocked} [moderationStatus] Filter by moderation status.
 * @apiQuery {String} [search] Search in title and description.
 * @apiQuery {Number} [limit=20] Limit number of results.
 * @apiQuery {Number} [offset=0] Offset for pagination.
 *
 */
alertsRouter.get(
  "/",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const {
        category,
        limit = "20",
        offset = "0",
        urgencyLevel,
        search,
        status,
        moderationStatus,
        locationLat,
        locationLng,
        radius,
      } = req.query;

      const filters: string[] = [];
      const params: any[] = [];

      if (category) {
        filters.push(`"category" = $${params.length + 1}::"AlertCategory"`);
        params.push(category);
      }
      if (urgencyLevel) {
        filters.push(`"urgency_level" = $${params.length + 1}::"UrgencyLevel"`);
        params.push(urgencyLevel);
      }
      if (status) {
        filters.push(`"status" = $${params.length + 1}::"AlertStatus"`);
        params.push(status);
      }
      if (moderationStatus) {
        filters.push(
          `"moderation_status" = $${params.length + 1}::"ModerationStatus"`
        );
        params.push(moderationStatus);
      }

      if (req.role === "user") {
        filters.push(`a.user_id != $${params.length + 1}`);
        params.push(req.userId);
      }

      if (search) {
        filters.push(
          `("title" ILIKE $${params.length + 1} OR "description" ILIKE $${
            params.length + 2
          })`
        );
        params.push(`%${search}%`, `%${search}%`);
      }

      const whereClause = filters.length
        ? `WHERE ${filters.join(" AND ")}`
        : "";

      let distanceExpr = "0";
      let radiusFilter: number | null = null;

      if (req.role === "user") {
        if (!locationLat || !locationLng) {
          return res.status(400).json({ error: "Location is required" });
        }

        const lat = parseFloat(locationLat as string);
        const lng = parseFloat(locationLng as string);
        radiusFilter = radius ? parseFloat(radius as string) : null;

        distanceExpr = `(6371000 * acos(
          cos(radians($${params.length + 1}))
          * cos(radians("location_lat"))
          * cos(radians("location_lng") - radians($${params.length + 2}))
          + sin(radians($${params.length + 1}))
          * sin(radians("location_lat"))
        ))`;
        params.push(lat, lng);
      }

      const countQuery = `
        SELECT COUNT(*)::int AS total
        FROM (
          SELECT a.id, ${distanceExpr} AS distance
          FROM "Alert" a
          ${whereClause}
        ) AS sub
        ${
          req.role === "user" && radiusFilter
            ? `WHERE sub.distance <= ${radiusFilter}`
            : ""
        };
      `;
      const countResult: any[] = await prisma.$queryRawUnsafe(
        countQuery,
        ...params
      );
      const total = countResult[0]?.total || 0;

      const query = `
      SELECT sub.*, 
             json_build_object(
               'id', u.id,
               'full_name', u.full_name,
               'username', u.username,
               'email', u.email,
               'profile_picture_url', u.profile_picture_url
             ) AS poster,
             (
               SELECT COUNT(*)::int
               FROM "AlertAcknowledgement" aa
               WHERE aa.alert_id = sub.id
             ) AS acknowledgements_count
      FROM (
        SELECT a.*, ${distanceExpr} AS distance
        FROM "Alert" a
        ${whereClause}
      ) AS sub
      JOIN "User" u ON sub.user_id = u.id
      ${
        req.role === "user" && radiusFilter
          ? `WHERE sub.distance <= ${radiusFilter}`
          : ""
      }
      ORDER BY sub.created_at DESC
      OFFSET ${parseInt(offset as string)}
      LIMIT ${parseInt(limit as string)};
    `;

      const alerts: any[] = await prisma.$queryRawUnsafe(query, ...params);

      const camelizedAlerts = keysToCamel<any[]>(alerts);

      for (const alert of camelizedAlerts) {
        if (Array.isArray(alert.attachments) && alert.attachments.length > 0) {
          alert.attachments = await createSignedUrls(alert.attachments);
        }
      }

      const page =
        Math.floor(parseInt(offset as string) / parseInt(limit as string)) + 1;
      const totalPages = Math.ceil(total / parseInt(limit as string));

      return res.status(200).json({
        data: camelizedAlerts,
        pagination: {
          total,
          page,
          limit: parseInt(limit as string),
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        message: "Alerts fetched successfully!",
      });
    } catch (error) {
      console.error("Get alerts error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * @api {patch} /alerts Update an Alert
 * @apiName UpdateAlert
 * @apiGroup Alerts
 *
 * @apiHeader {String} Authorization Bearer access token.
 *
 * @apiBody {String} alertId                   ID of the alert to update (required).
 * @apiBody {String} [title]              Title of the alert.
 * @apiBody {String} [description]        Detailed description of the alert.
 * @apiBody {String} [category]           Category of the alert.
 * @apiBody {String="normal","high","low"} [urgencyLevel] Urgency level.
 * @apiBody {Number} [locationLat]        Latitude of the alert location.
 * @apiBody {Number} [locationLng]        Longitude of the alert location.
 * @apiBody {File[]} [attachments]        Optional new file attachments (multipart formdata).
 *
 */
alertsRouter.patch(
  "/",
  verifyAccessToken,
  upload.array("attachments"),
  async (req: Request, res: Response) => {
    try {
      const { alertId } = req.body || {};
      const userId = req.userId!;

      if (!alertId) {
        return res.status(400).json({ error: "Alert ID is required" });
      }

      const existingAlert = await prisma.alert.findUnique({
        where: { id: alertId },
      });
      if (!existingAlert) {
        return res.status(404).json({ error: "Alert not found" });
      }

      if (existingAlert.userId !== userId) {
        return res
          .status(403)
          .json({ error: "Not authorized to update this alert" });
      }

      const {
        title,
        description,
        category,
        urgencyLevel,
        locationLat,
        locationLng,
      } = req.body || {};

      const newAttachments: string[] = [];

      if (req.files && Array.isArray(req.files)) {
        for (const file of req.files as Express.Multer.File[]) {
          const safeName = file.originalname.replace(/\s+/g, "_");
          const filePath = `alerts/${alertId}/${Date.now()}_${safeName}`;

          const { data, error } = await supabase.storage
            .from("attachments")
            .upload(filePath, file.buffer, {
              cacheControl: "3600",
              upsert: false,
            });

          if (error) {
            console.error("Supabase upload error:", error);
            continue;
          }
          newAttachments.push(data.path);
        }
      }

      const updatedAlert = await prisma.alert.update({
        where: { id: alertId },
        data: {
          category,
          description,
          title,
          urgencyLevel,
          ...(newAttachments.length > 0 && {
            attachments: [
              ...((existingAlert.attachments as Prisma.JsonArray) || []),
              ...(newAttachments as Prisma.JsonArray),
            ],
          }),
          ...(locationLat !== undefined && {
            locationLat: parseFloat(locationLat),
          }),
          ...(locationLng !== undefined && {
            locationLng: parseFloat(locationLng),
          }),
        },
      });

      return res.status(200).json({
        message: "Alert updated successfully",
        alert: updatedAlert,
      });
    } catch (error) {
      console.error("Update alert error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * @api {patch} /alerts/cancel Cancel an Alert
 * @apiName CancelAlert
 * @apiGroup Alerts
 *
 * @apiHeader {String} Authorization Bearer access token.
 *
 * @apiBody {String} alertId   ID of the alert to cancel (required).
 *
 */
alertsRouter.patch(
  "/cancel",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const { alertId } = req.body || {};
      const userId = req.userId!;

      if (!alertId) {
        return res.status(400).json({ error: "Alert ID is required" });
      }

      const existingAlert = await prisma.alert.findUnique({
        where: { id: alertId },
      });
      if (!existingAlert) {
        return res.status(404).json({ error: "Alert not found" });
      }

      if (existingAlert.userId !== userId) {
        return res
          .status(403)
          .json({ error: "Not authorized to cancel this alert" });
      }

      if (existingAlert.status !== "active") {
        return res.status(400).json({
          error: `Cannot cancel an already ${existingAlert.status} Alert`,
        });
      }

      const cancelledAlert = await prisma.alert.update({
        where: { id: alertId },
        data: { status: "cancelled" },
      });

      return res.status(200).json({
        message: "Alert cancelled successfully",
        alert: cancelledAlert,
      });
    } catch (error) {
      console.error("Cancel alert error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * @api {post} /alerts/acknowledgement Acknowledge an Alert
 * @apiName AcknowledgeAlert
 * @apiGroup Alerts
 *
 * @apiHeader {String} Authorization Bearer access token.
 *
 * @apiBody {String} alertId                 ID of the alert (required).
 * @apiBody {String} [comments]         Optional Comments.
 *
 */
alertsRouter.post(
  "/acknowledgement",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const { alertId, comments } = req.body || {};
      const userId = req.userId!;

      if (!alertId) {
        return res.status(400).json({ error: "Alert ID is required" });
      }

      const alert = await prisma.alert.findUnique({
        where: { id: alertId },
      });
      if (!alert) {
        return res.status(404).json({ error: "Alert not found" });
      }

      if (alert.userId === userId) {
        return res
          .status(400)
          .json({ error: "You cannot acknowledge your own alert" });
      }

      const acknowledgement = await prisma.alertAcknowledgement.create({
        data: {
          alertId,
          userId,
          comments,
        },
      });

      return res.status(201).json({
        message: "Alert acknowledged successfully",
        acknowledgement,
      });
    } catch (error: any) {
      if (error.code === "P2002") {
        return res
          .status(400)
          .json({ error: "You have already acknowledged this alert" });
      }

      console.error("Error acknowledging alert:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * @api {patch} /alerts/acknowledgement Update Alert Acknowledgement
 * @apiName UpdateAlertAcknowledgement
 * @apiGroup Alerts
 *
 * @apiHeader {String} Authorization Bearer access token.
 *
 * @apiBody {String} alertId          ID of the alert to update acknowledgement for (required).
 * @apiBody {String} [comments]       Optional new comment.
 *
 */
alertsRouter.patch(
  "/acknowledgement",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const { comments, alertId } = req.body || {};
      const userId = req.userId!;

      if (!alertId) {
        return res.status(400).json({ error: "Alert ID is required" });
      }

      const acknowledgement = await prisma.alertAcknowledgement.findUnique({
        where: {
          alertId_userId: {
            alertId,
            userId,
          },
        },
      });

      if (!acknowledgement) {
        return res
          .status(404)
          .json({ error: "You haven't acknowledged this alert yet" });
      }

      const updatedAcknowledgement = await prisma.alertAcknowledgement.update({
        where: {
          alertId_userId: {
            alertId,
            userId,
          },
        },
        data: {
          comments,
        },
      });

      return res.status(200).json({
        message: "Acknowledgement updated successfully",
        acknowledgement: updatedAcknowledgement,
      });
    } catch (error) {
      console.error("Error updating acknowledgement:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * @api {delete} /alerts/acknowledgement Revoke Alert Acknowledgement
 * @apiName RevokeAlertAcknowledgement
 * @apiGroup Alerts
 *
 * @apiHeader {String} Authorization Bearer access token.
 *
 * @apiBody {String} alertId   ID of the alert to revoke acknowledgement for (required).
 *
 */
alertsRouter.delete(
  "/acknowledgement",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const { alertId } = req.body || {};
      const userId = req.userId!;

      if (!alertId) {
        return res.status(400).json({ error: "Alert ID is required" });
      }

      const acknowledgement = await prisma.alertAcknowledgement.findUnique({
        where: {
          alertId_userId: {
            alertId,
            userId,
          },
        },
      });

      if (!acknowledgement) {
        return res
          .status(404)
          .json({ error: "You haven't acknowledged this alert yet" });
      }

      await prisma.alertAcknowledgement.delete({
        where: {
          alertId_userId: {
            alertId,
            userId,
          },
        },
      });

      return res.status(200).json({
        message: "Acknowledgement revoked successfully",
      });
    } catch (error) {
      console.error("Error revoking acknowledgement:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * @api {patch} /alerts/moderation-status Update Moderation Status
 * @apiName UpdateAlertModerationStatus
 * @apiGroup Alerts
 * @apiPermission admin
 *
 * @apiHeader {String} Authorization Bearer token (JWT Access Token).
 *
 * @apiBody {String} alertId ID of the alert to update (required).
 * @apiBody {String="clean","flagged","reviewed","blocked"} moderationStatus New moderation status (required).
 *
 */
alertsRouter.patch(
  "/moderation-status",
  verifyAccessToken,
  verifyRole(["admin"]),
  async (req: Request, res: Response) => {
    try {
      const { alertId, moderationStatus } = req.body || {};

      if (!alertId || !moderationStatus) {
        return res
          .status(400)
          .json({ error: "alertId and moderationStatus are required" });
      }

      const updatedAlert = await prisma.alert.update({
        where: { id: alertId },
        data: { moderationStatus },
      });

      return res.status(200).json({
        message: "Alert moderation status updated successfully",
        alert: updatedAlert,
      });
    } catch (error: any) {
      console.error("Error updating alert moderation status:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

/**
 * @api {get} /alerts/me Get User's Own Alerts (Paginated)
 * @apiName GetUserAlertsPaginated
 * @apiGroup Alerts
 *
 * @apiHeader {String} Authorization Bearer token (JWT Access Token).
 *
 * @apiQuery {String} [cursor] The ID of the last fetched request (for pagination).
 * @apiQuery {Number} [limit=20] Number of Alerts to fetch per page.
 *
 */
alertsRouter.get(
  "/me",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const limit = parseInt(req.query.limit as string) || 20;

      const cursorCreatedAt = req.query.cursorCreatedAt as string | undefined;
      const cursorId = req.query.cursorId as string | undefined;

      const alerts = await prisma.alert.findMany({
        where: { userId },
        include: {
          acknowledgements: {
            include: {
              user: true,
            },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(cursorCreatedAt && cursorId
          ? {
              skip: 1,
              cursor: {
                createdAt_id: {
                  createdAt: new Date(cursorCreatedAt),
                  id: cursorId,
                },
              },
            }
          : {}),
      });

      for (const alert of alerts) {
        if (Array.isArray(alert.attachments) && alert.attachments.length > 0) {
          alert.attachments = await createSignedUrls(
            alert.attachments as string[]
          );
        }
      }

      const hasExtra = alerts.length > limit;
      if (hasExtra) {
        alerts.pop();
      }

      const lastItem = alerts[alerts.length - 1];
      const nextCursor = lastItem
        ? { id: lastItem.id, createdAt: lastItem.createdAt.toISOString() }
        : null;

      return res.status(200).json({
        message: "User's alerts fetched successfully",
        data: alerts,
        nextCursor,
      });
    } catch (error: any) {
      console.error("Fetch user alerts error:", error);
      return res
        .status(500)
        .json({ error: error.message || "Internal server error" });
    }
  }
);
