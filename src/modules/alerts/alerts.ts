import { type Request, type Response, Router } from "express";
import { verifyAccessToken } from "../../middleware/verifyAccessToken.js";
import prisma from "./../../utils/prisma.js";
import upload from "../../middleware/multer.js";
import { Prisma } from "../../../generated/prisma/index.js";
import supabase from "./../../utils/supabase.js";
import { createSignedUrls } from "../../utils/createSignedURL.js";

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

alertsRouter.get(
  "/",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const {
        category,
        urgency_level,
        status,
        moderation_status,
        search,
        limit = "20",
        offset = "0",
        location_lat,
        location_lng,
        radius,
      } = req.query;

      if (!location_lat || !location_lng) {
        return res.status(400).json({ error: "Location is required" });
      }

      const lat = parseFloat(location_lat as string);
      const lng = parseFloat(location_lng as string);
      const radiusFilter = radius ? parseFloat(radius as string) : null;

      const filters: string[] = [];
      const params: any[] = [];

      if (category) {
        filters.push(`"category" = $${params.length + 1}`);
        params.push(category);
      }
      if (urgency_level) {
        filters.push(`"urgency_level" = $${params.length + 1}`);
        params.push(urgency_level);
      }
      if (status) {
        filters.push(`"status" = $${params.length + 1}`);
        params.push(status);
      }
      if (moderation_status) {
        filters.push(`"moderation_status" = $${params.length + 1}`);
        params.push(moderation_status);
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

      const distanceExpr = `(6371000 * acos(cos(radians($${
        params.length + 1
      })) * cos(radians("location_lat")) * cos(radians("location_lng") - radians($${
        params.length + 2
      })) + sin(radians($${
        params.length + 1
      })) * sin(radians("location_lat"))))`;
      params.push(lat, lng);

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
                 SELECT COUNT(*) 
                 FROM "AlertAcknowledgement" aa 
                 WHERE aa.alert_id = sub.id
               )::int AS acknowledgements_count
        FROM (
          SELECT a.*, ${distanceExpr} AS distance
          FROM "Alert" a
          ${whereClause}
        ) AS sub
        JOIN "User" u ON sub.user_id = u.id
        ${radiusFilter ? `WHERE sub.distance <= ${radiusFilter}` : ""}
        ORDER BY sub.distance ASC, sub.created_at DESC
        OFFSET ${parseInt(offset as string)}
        LIMIT ${parseInt(limit as string)};
      `;

      let alerts: any[] = await prisma.$queryRawUnsafe(query, ...params);

      for (const alert of alerts) {
        if (Array.isArray(alert.attachments) && alert.attachments.length > 0) {
          alert.attachments = await createSignedUrls(alert.attachments);
        }
      }

      return res.status(200).json({ success: true, alerts });
    } catch (error) {
      console.error("Get alerts error:", error);
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
