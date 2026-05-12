import { type Request, type Response, Router } from "express";
import { verifyAccessToken } from "../../middleware/verifyAccessToken.js";
import prisma from "./../../utils/prisma.js";
import upload from "../../middleware/multer.js";
import { Prisma } from "../../../generated/prisma/index.js";
import supabase from "./../../utils/supabase.js";
import { createSignedUrls } from "../../utils/createSignedURL.js";
import { keysToCamel } from "../../utils/camelize.js";
import { verifyRole } from "../../middleware/verifyRole.js";
import { broadcast } from "../../utils/ws.js";
import { broadcastNotification } from "../../services/notificationService.js";
import { calculateExpiryDate } from "../../utils/calculateExpiry.js";

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
      // Fetch user to check verification status
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isVerified: true },
      });

      // Create initial alert record (without attachments yet)
      const initialAlert = await prisma.alert.create({
        data: {
          userId,
          title,
          description,
          category,
          urgencyLevel,
          locationLat: parseFloat(locationLat),
          locationLng: parseFloat(locationLng),
          expiresAt: calculateExpiryDate(
            "alert",
            urgencyLevel || "normal",
            user?.isVerified || false,
          ),
          attachments: [],
        },
      });

      // Kick off background tasks (uploads, db update, notifications)
      (async () => {
        try {
          const attachmentsArray: string[] = [];

          // Handle file uploads
          if (req.files && Array.isArray(req.files)) {
            for (const file of req.files as Express.Multer.File[]) {
              const safeName = file.originalname.replace(/\s+/g, "_");
              const filePath = `alerts/${initialAlert.id}/${Date.now()}_${safeName}`;

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
              attachmentsArray.push(data.path);
            }
          }

          // Update alert with attachment paths if any were uploaded
          let finalAlert = initialAlert;
          if (attachmentsArray.length > 0) {
            finalAlert = await prisma.alert.update({
              where: { id: initialAlert.id },
              data: { attachments: attachmentsArray as Prisma.InputJsonValue },
            });
          }

          broadcast("alerts_changed");

          // Broadcast alert to all nearby users (20km radius, no limit, exclude creator)
          await broadcastNotification(
            `Alert: ${finalAlert.title}`,
            finalAlert.description ||
              "A new alert has been posted in your area.",
            "alert_nearby",
            { alertId: finalAlert.id },
            Number(finalAlert.locationLat),
            Number(finalAlert.locationLng),
            20, // 20km radius for alerts
            undefined, // no limit
            finalAlert.userId, // exclude the creator
            false, // verifiedOnly
          );
        } catch (backgroundError) {
          console.error(
            "Background task error (Create Alert):",
            backgroundError,
          );
        }
      })();

      return res.status(201).json({
        message: "Alert created successfully",
        alert: initialAlert,
      });
    } catch (error) {
      console.error("Create alert error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
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
      // --- Query params (strings) ---
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
        // new params for cursor-based infinite scroll and sorting
        cursorCreatedAt,
        cursorId,
        cursorDistance,
      } = req.query;

      let { sort = "nearest" } = req.query;

      // --- helpers ---
      const parseBool = (val: any) =>
        val === "true" ? true : val === "false" ? false : undefined;

      const parseNumber = (v: any, fallback: number) =>
        v === undefined ? fallback : Number(v);

      const isUser = req.role === "user";
      const isAdmin = req.role === "admin";

      const params: any[] = [];
      const filters: string[] = [];

      // --- role-specific base filters ---
      if (isUser) {
        // users should not see blocked items
        filters.push(
          `a.moderation_status != $${params.length + 1}::"ModerationStatus"`,
        );
        params.push("blocked");

        // user should not see their own alerts
        filters.push(`a.user_id != $${params.length + 1}`);
        params.push(req.userId);

        filters.push(`a.status = $${params.length + 1}::"AlertStatus"`);
        params.push("active");
      } else {
        // admin can optionally filter by moderationStatus passed via query
        if (moderationStatus) {
          filters.push(
            `a.moderation_status = $${params.length + 1}::"ModerationStatus"`,
          );
          params.push(moderationStatus);
        }
      }

      // --- filters from query ---
      if (category) {
        filters.push(`a.category = $${params.length + 1}::"AlertCategory"`);
        params.push(category);
      }
      if (urgencyLevel) {
        filters.push(`a.urgency_level = $${params.length + 1}::"UrgencyLevel"`);
        params.push(urgencyLevel);
      }
      if (status) {
        filters.push(`a.status = $${params.length + 1}::"AlertStatus"`);
        params.push(status);
      }

      if (search) {
        filters.push(
          `(a.title ILIKE $${params.length + 1} OR a.description ILIKE $${
            params.length + 2
          })`,
        );
        params.push(`%${search}%`, `%${search}%`);
      }

      const whereClause = filters.length
        ? `WHERE ${filters.join(" AND ")}`
        : "";

      // --- distance expression (only relevant when we need distance or nearest sort) ---
      let distanceExpr = "NULL"; // default if unused
      let needDistance = false;
      let radiusFilter: number | null = null;

      const wantNearest = sort === "nearest";
      const hasLocation = locationLat && locationLng;

      if (isUser && !hasLocation && (wantNearest || radius)) {
        return res.status(400).json({
          error:
            "locationLat and locationLng are required for nearest sorting / radius filtering",
        });
      }

      if (hasLocation) {
        const lat = parseFloat(locationLat as string);
        const lng = parseFloat(locationLng as string);
        radiusFilter = radius ? parseFloat(radius as string) : null;

        distanceExpr = `(6371000 * acos(
          cos(radians($${params.length + 1}))
          * cos(radians(a.location_lat))
          * cos(radians(a.location_lng) - radians($${params.length + 2}))
          + sin(radians($${params.length + 1}))
          * sin(radians(a.location_lat))
        ))`;
        params.push(lat, lng);
        needDistance = true;
      }

      // --- select extra fields for user (alreadyAcknowledged) ---
      let selectExtra = "";
      if (isUser) {
        const userIdParamIndex = params.length + 1;
        params.push(req.userId);
        selectExtra = `,
          CASE
            WHEN EXISTS (
              SELECT 1 FROM "AlertAcknowledgement" aa
              WHERE aa.alert_id = sub.id
                AND aa.user_id = $${userIdParamIndex}
            ) THEN true ELSE false END AS "alreadyAcknowledged"
        `;
      }

      // --- Build ordering and cursor logic ---
      const limitNum = Math.max(
        1,
        Math.min(100, parseInt(limit as string, 10) || 20),
      ); // clamp
      const offsetNum = Math.max(0, parseInt(offset as string, 10) || 0);

      // Cursor params
      const hasCursor =
        (cursorCreatedAt && cursorId) ||
        (cursorDistance && cursorId && wantNearest);

      // We'll fetch limit + 1 rows when using cursor to determine hasNextPage
      const fetchLimit = limitNum + 1;

      // Build ORDER BY clause and cursor WHERE condition depending on sort
      if (isAdmin) {
        sort = "latest";
      }
      let orderBy =
        "CAST(sub.distance AS double precision) ASC, sub.created_at DESC, sub.id DESC";
      let cursorCondition = ""; // will be appended inside sub-query where clause
      if (sort === "latest") {
        orderBy = "sub.created_at DESC, sub.id DESC";
        if (hasCursor && cursorCreatedAt && cursorId) {
          // next page for DESC: rows where (created_at, id) < (cursorCreatedAt, cursorId)
          params.push(cursorCreatedAt, cursorId);
          cursorCondition = ` AND (a.created_at < $$${
            params.length - 1
          } OR (a.created_at = $${params.length - 1} AND a.id < $$${
            params.length
          }))`;
        }
      } else if (sort === "oldest") {
        orderBy = "sub.created_at ASC, sub.id ASC";
        if (hasCursor && cursorCreatedAt && cursorId) {
          // next page for ASC: rows where (created_at, id) > (cursorCreatedAt, cursorId)
          params.push(cursorCreatedAt, cursorId);
          cursorCondition = ` AND (a.created_at > $$${
            params.length - 1
          } OR (a.created_at = $${params.length - 1} AND a.id > $$${
            params.length
          }))`;
        }
      } else if (sort === "nearest") {
        orderBy = "sub.distance ASC, sub.created_at DESC, sub.id DESC";
        if (!needDistance) {
          return res.status(400).json({
            error: "locationLat & locationLng required for nearest sort",
          });
        }

        if (hasCursor && cursorDistance && cursorId) {
          // push cursorDistance then cursorId
          params.push(Number(cursorDistance), cursorId);
          // cursorCondition uses distanceExpr which contains placeholders referencing earlier params
          cursorCondition = ` AND (CAST(${distanceExpr} AS double precision) > $${
            params.length - 1
          } OR (CAST(${distanceExpr} AS double precision) = $${
            params.length - 1
          } AND a.id < $${params.length}))`;
        }
      }

      // --- Build the subquery with filters + optional cursorCondition + distance expression ---
      const subWhere = whereClause ? `${whereClause}` : "";
      const subWhereWithCursor = cursorCondition
        ? subWhere
          ? subWhere.replace(/^WHERE\s*/, "WHERE (") +
            `) AND (${cursorCondition.slice(5)})`
          : `WHERE ${cursorCondition.slice(5)}`
        : subWhere;

      const innerSelect = `
        SELECT a.*, ${needDistance ? distanceExpr : "NULL"} AS distance
        FROM "Alert" a
        ${subWhereWithCursor}
      `;

      // --- For admin we want offset pagination and total count. For users infinite scroll, we return cursors. ---
      let finalQuery = "";
      let finalParams = [...params];

      if (isAdmin) {
        // Admin: do offset pagination and include total count
        const countQuery = `
          SELECT COUNT(*)::int AS total
          FROM (
            ${innerSelect}
          ) sub_count;
        `;
        const countResult: any[] = await prisma.$queryRawUnsafe(
          countQuery,
          ...finalParams,
        );
        const total = countResult[0]?.total || 0;

        finalQuery = `
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
                 ${selectExtra}
          FROM (
            ${innerSelect}
          ) AS sub
          JOIN "User" u ON sub.user_id = u.id
          ORDER BY ${orderBy}
          OFFSET $${finalParams.length + 1}
          LIMIT $${finalParams.length + 2};
        `;
        finalParams.push(offsetNum, limitNum);
      } else {
        // User / infinite scroll
        finalQuery = `
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
                 ${selectExtra}
          FROM (
            ${innerSelect}
          ) AS sub
          JOIN "User" u ON sub.user_id = u.id
          ${radiusFilter ? `WHERE sub.distance <= ${radiusFilter}` : ""}
          ORDER BY ${orderBy}
          LIMIT $${finalParams.length + 1};
        `;
        finalParams.push(fetchLimit);
      }

      // --- Execute query ---
      const rows: any[] = await prisma.$queryRawUnsafe(
        finalQuery,
        ...finalParams,
      );
      const camelizedAlerts = keysToCamel<any[]>(rows || []);

      // --- If using cursor-based (user), determine hasNextPage and trim results ---
      let pagination: any = {};
      if (isAdmin) {
        const page = Math.floor(offsetNum / limitNum) + 1;
        const countResult: any[] = await prisma.$queryRawUnsafe(
          `SELECT COUNT(*)::int AS total FROM (${innerSelect}) sub_count;`,
          ...params,
        );

        const totalCount = countResult[0]?.total || 0;

        const totalPages = Math.ceil(totalCount / limitNum);
        pagination = {
          total: totalCount,
          page,
          limit: limitNum,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        };
      } else {
        const hasNextPage = camelizedAlerts.length > limitNum;
        const items = hasNextPage
          ? camelizedAlerts.slice(0, limitNum)
          : camelizedAlerts;

        // compute next cursor (based on chosen sort)
        let nextCursor: any = null;
        if (items.length > 0) {
          const last = items[items.length - 1];
          if (sort === "nearest") {
            nextCursor = {
              cursorDistance: last.distance,
              cursorId: last.id,
            };
          } else {
            nextCursor = {
              cursorCreatedAt: last.createdAt,
              cursorId: last.id,
            };
          }
        }

        pagination = {
          hasNextPage,
          nextCursor,
          limit: limitNum,
        };

        // replace camelizedAlerts with trimmed items
        camelizedAlerts.splice(0, camelizedAlerts.length, ...items);
        console.log("🚀 ~ camelizedAlerts:", camelizedAlerts);
      }

      // --- Attach signed URLs for attachments if present (async loop) ---
      for (const alert of camelizedAlerts) {
        if (Array.isArray(alert.attachments) && alert.attachments.length > 0) {
          alert.attachments = await createSignedUrls(alert.attachments);
        }
      }

      return res.status(200).json({
        data: camelizedAlerts,
        pagination,
        message: "Alerts fetched successfully!",
      });
    } catch (error) {
      console.error("Get alerts error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

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
            alert.attachments as string[],
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
      console.log("🚀 ~ alerts:", alerts);

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
  },
);

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

      // ... existing findUnique and auth checks ...
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
      broadcast("alerts_changed", { alertId }); // Updated broadcast

      return res.status(200).json({
        message: "Alert updated successfully",
        alert: updatedAlert,
      });
    } catch (error) {
      console.error("Update alert error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * @api {patch} /alerts/cancel Cancel an Alert
 * ...
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
      broadcast("alerts_changed", { alertId }); // Updated broadcast

      return res.status(200).json({
        message: "Alert cancelled successfully",
        alert: cancelledAlert,
      });
    } catch (error) {
      console.error("Cancel alert error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

alertsRouter.patch(
  "/resolve",
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
          .json({ error: "Not authorized to resolve this alert" });
      }

      if (existingAlert.status !== "active") {
        return res.status(400).json({
          error: `Cannot resolve an already ${existingAlert.status} Alert`,
        });
      }

      const resolvedAlert = await prisma.alert.update({
        where: { id: alertId },
        data: { status: "resolved" },
      });
      broadcast("alerts_changed", { alertId }); // Updated broadcast

      return res.status(200).json({
        message: "Alert resolved successfully",
        alert: resolvedAlert,
      });
    } catch (error) {
      console.error("Resolve alert error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * @api {post} /alerts/acknowledgement Acknowledge an Alert
 * ...
 */
alertsRouter.post(
  "/acknowledge",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const { alertId } = req.body || {};
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
        },
      });
      broadcast("alerts_changed", { alertId }); // Updated broadcast

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
  },
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
  },
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
  },
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
      broadcast("alerts_changed");

      return res.status(200).json({
        message: "Alert moderation status updated successfully",
        alert: updatedAlert,
      });
    } catch (error: any) {
      console.error("Error updating alert moderation status:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  },
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

/**
 * @api {get} /alerts/:alertId Get Single Alert Details
 * @apiName GetAlertDetails
 * @apiGroup Alerts
 * @apiPermission authenticated
 *
 * @apiHeader {String} Authorization Bearer token (JWT Access Token).
 *
 * @apiParam {String} alertId ID of the alert to fetch.
 */
alertsRouter.get(
  "/:alertId",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const { alertId } = req.params;
      const userId = req.userId!;

      if (!alertId) {
        return res.status(400).json({ error: "Alert ID is required" });
      }

      const alert = await prisma.alert.findUnique({
        where: { id: alertId },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              username: true,
              profilePictureUrl: true,
            },
          },
          _count: {
            select: {
              acknowledgements: true,
            },
          },
        },
      });

      if (!alert) {
        return res.status(404).json({ error: "Alert not found" });
      }

      // Check if user has acknowledged
      const acknowledgement = await prisma.alertAcknowledgement.findUnique({
        where: {
          alertId_userId: {
            alertId,
            userId,
          },
        },
      });

      const isOwnAlert = alert.userId === userId;

      // Attach signed URLs for attachments
      if (Array.isArray(alert.attachments) && alert.attachments.length > 0) {
        alert.attachments = await createSignedUrls(
          alert.attachments as string[],
        );
      }

      return res.status(200).json({
        ...alert,
        poster: alert.user,
        acknowledgementsCount: (alert as any)._count?.acknowledgements || 0,
        alreadyAcknowledged: !!acknowledgement,
        isOwnAlert,
      });
    } catch (error) {
      console.error("Get alert details error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * @api {patch} /alerts/renew Renew an Alert
 * @apiName RenewAlert
 * @apiGroup Alerts
 * @apiPermission authenticated
 * @apiHeader {String} Authorization Bearer Token
 * @apiBody {String} alertId ID of the alert
 */
alertsRouter.patch(
  "/renew",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const { alertId } = req.body;
      const userId = req.userId!;

      if (!alertId) {
        return res.status(400).json({ error: "Alert ID is required" });
      }

      const alert = await prisma.alert.findUnique({
        where: { id: alertId },
        include: { user: { select: { isVerified: true } } },
      });

      if (!alert) {
        return res.status(404).json({ error: "Alert not found" });
      }

      if (alert.userId !== userId) {
        return res
          .status(403)
          .json({ error: "Only the owner can renew this alert" });
      }

      if (alert.status !== "active" && alert.status !== "expired") {
        return res
          .status(400)
          .json({ error: `Cannot renew a ${alert.status} alert` });
      }

      // Check renewal conditions: less than 24h remaining or already expired
      const now = new Date();
      const expiresAt = alert.expiresAt ? new Date(alert.expiresAt) : null;

      const isExpired = expiresAt && expiresAt < now;
      const hoursRemaining = expiresAt
        ? (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60)
        : 0;

      if (!isExpired && hoursRemaining > 24) {
        return res
          .status(400)
          .json({ error: "You can only renew within 24 hours of expiration" });
      }

      const newExpiry = calculateExpiryDate(
        "alert",
        alert.urgencyLevel as "high" | "normal" | "low",
        alert.user?.isVerified || false,
      );

      const updatedAlert = await prisma.alert.update({
        where: { id: alertId },
        data: {
          expiresAt: newExpiry,
          status: "active",
          createdAt: new Date(), // Bump to top
          renewedCount: { increment: 1 },
        },
      });

      broadcast("alerts_changed", { alertId });

      return res.status(200).json({
        message: "Alert renewed and bumped to top!",
        data: updatedAlert,
      });
    } catch (error) {
      console.error("Renew alert error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);
