import { type Request, type Response, Router } from "express";
import { verifyAccessToken } from "../../middleware/verifyAccessToken.ts";
import supabase from "../../utils/supabase.ts";
import prisma from "../../utils/prisma.ts";
import { Prisma } from "../../../generated/prisma/index.js";
import upload from "../../middleware/multer.ts";
import { createSignedUrls } from "../../utils/createSignedURL.ts";
import { verifyRole } from "../../middleware/verifyRole.ts";

export const requestsRouter = Router();

/**
 * @api {post} /requests Create a Request
 * @apiName CreateRequest
 * @apiGroup Requests
 *
 * @apiHeader {String} Authorization Bearer token (JWT) from login.
 *
 * @apiBody {String} title Title of the request (required).
 * @apiBody {String} [description] Optional detailed description of the request.
 * @apiBody {String} [category="general"] Category of the request.
 * @apiBody {String="normal","high","low"} [urgency_level="normal"] Urgency level.
 * @apiBody {Number} location_lat Latitude of the request location (required).
 * @apiBody {Number} location_lng Longitude of the request location (required).
 * @apiBody {Boolean} [post_anonymously=false] Whether to post the request anonymously.
 * @apiBody {Boolean} [visibility_verified_only=false] Whether only verified users can see.
 * @apiBody {Boolean} [visibility_women_only=false] Whether only women can see.
 * @apiBody {Boolean} [allow_multiple_helpers=false] Whether multiple helpers are allowed.
 * @apiBody {Number} [max_helpers] Maximum number of helpers.
 * @apiBody {File[]} [attachments] Array of files to attach (multipart/form-data, optional).
 *
 * @apiSuccess {Boolean} success Indicates request creation success.
 * @apiSuccess {String} message Response message.
 * @apiSuccess {Object} request Created request object.
 * @apiSuccess {String} request.id Unique ID of the request.
 * @apiSuccess {String} request.userId ID of the user who created the request.
 * @apiSuccess {String} request.title Request title.
 * @apiSuccess {String} [request.description] Request description.
 * @apiSuccess {String} request.category Category of the request.
 * @apiSuccess {String="normal","high","low"} request.urgencyLevel Urgency level.
 * @apiSuccess {String="pending","partially_accepted","accepted","completed","cancelled","expired"} request.status Current status of the request.
 * @apiSuccess {Number} request.locationLat Latitude of request location.
 * @apiSuccess {Number} request.locationLng Longitude of request location.
 * @apiSuccess {Boolean} request.postAnonymously Whether posted anonymously.
 * @apiSuccess {Boolean} request.visibilityVerifiedOnly Visibility restricted to verified users.
 * @apiSuccess {Boolean} request.visibilityWomenOnly Visibility restricted to women.
 * @apiSuccess {Number} request.priorityScore Priority score (calculated internally, default 0).
 * @apiSuccess {Number} request.reportedCount Number of reports on this request.
 * @apiSuccess {String="clean","flagged","reviewed","blocked"} request.moderationStatus Moderation status.
 * @apiSuccess {Number} request.responsesCount Number of responses to the request.
 * @apiSuccess {Boolean} request.allowMultipleHelpers Whether multiple helpers are allowed.
 * @apiSuccess {Number} [request.maxHelpers] Maximum number of helpers allowed.
 * @apiSuccess {Date} [request.completedAt] Timestamp when request was completed.
 * @apiSuccess {Date} [request.expiresAt] Expiration timestamp of request.
 * @apiSuccess {String[]} [request.attachments] Array of uploaded file paths.
 * @apiSuccess {Date} request.createdAt Request creation timestamp.
 * @apiSuccess {Date} request.updatedAt Request last update timestamp.
 *
 * @apiError {String} error Error message describing what went wrong.
 */
requestsRouter.post(
  "/",
  verifyAccessToken,
  upload.array("attachments"),
  async (req: Request, res: Response) => {
    const {
      title,
      description,
      category,
      urgency_level,
      location_lat,
      location_lng,
      post_anonymously,
      visibility_verified_only,
      visibility_women_only,
      max_helpers,
    } = req.body || {};

    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }
    if (!location_lat || !location_lng) {
      return res.status(400).json({ error: "Location is required" });
    }

    const userId = req.userId!;

    try {
      const newRequest = await prisma.$transaction(async (tx) => {
        let request = await tx.request.create({
          data: {
            userId,
            title,
            description,
            category: category || "general",
            urgencyLevel: urgency_level || "normal",
            locationLat: parseFloat(location_lat),
            locationLng: parseFloat(location_lng),
            postAnonymously: post_anonymously || false,
            visibilityVerifiedOnly: visibility_verified_only || false,
            visibilityWomenOnly: visibility_women_only || false,
            maxHelpers: max_helpers ? parseInt(max_helpers) : 1,
            attachments: [],
          },
        });

        const attachments: string[] = [];

        if (req.files && Array.isArray(req.files)) {
          for (const file of req.files as Express.Multer.File[]) {
            const safeName = file.originalname.replace(/\s+/g, "_");
            const filePath = `requests/${request.id}/${Date.now()}_${safeName}`;

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
          request = await tx.request.update({
            where: { id: request.id },
            data: { attachments: attachments as Prisma.InputJsonValue },
          });
        }

        return request;
      });

      return res.status(201).json({
        success: true,
        message: "Request created successfully",
        request: newRequest,
      });
    } catch (error) {
      console.error("Create request error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

requestsRouter.get(
  "/",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const {
        category,
        limit = "20",
        offset = "0",
        urgency_level,
        search,
        status,
        post_anonymously,
        visibility_verified_only,
        visibility_women_only,
        moderation_status,
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

      const parseBool = (val: any) =>
        val === "true" ? true : val === "false" ? false : undefined;

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
      if (post_anonymously) {
        filters.push(`"post_anonymously" = $${params.length + 1}`);
        params.push(parseBool(post_anonymously));
      }
      if (visibility_verified_only) {
        filters.push(`"visibility_verified_only" = $${params.length + 1}`);
        params.push(parseBool(visibility_verified_only));
      }
      if (visibility_women_only) {
        filters.push(`"visibility_women_only" = $${params.length + 1}`);
        params.push(parseBool(visibility_women_only));
      }
      if (moderation_status) {
        filters.push(`"moderation_status" = $${params.length + 1}`);
        params.push(moderation_status);
      }
      if (req.role === "user") {
        filters.push(`r.user_id != $${params.length + 1}`);
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

      let selectExtra = "";

      if (req.role === "user") {
        selectExtra = `, 
          CASE 
            WHEN EXISTS (
              SELECT 1 
              FROM "RequestParticipator" rp 
              WHERE rp.request_id = sub.id 
                AND rp.user_id = '${req.userId!}'
            ) THEN true 
            ELSE false 
          END AS "alreadyOffered"`;
      }

      const query = `
        SELECT sub.*, 
               json_build_object(
                 'id', u.id,
                 'full_name', u.full_name,
                 'username', u.username,
                 'email', u.email,
                 'profile_picture_url', u.profile_picture_url
               ) AS requester
               ${selectExtra}
        FROM (
          SELECT r.*, ${distanceExpr} AS distance
          FROM "Request" r
          ${whereClause}
        ) AS sub
        JOIN "User" u ON sub.user_id = u.id
        ${radiusFilter ? `WHERE sub.distance <= ${radiusFilter}` : ""}
        ORDER BY sub.distance ASC, sub.created_at DESC
        OFFSET ${parseInt(offset as string)}
        LIMIT ${parseInt(limit as string)};
      `;

      const requests: any[] = await prisma.$queryRawUnsafe(query, ...params);

      for (const request of requests) {
        if (
          Array.isArray(request.attachments) &&
          request.attachments.length > 0
        ) {
          request.attachments = await createSignedUrls(request.attachments);
        }
      }

      return res.status(200).json({ success: true, requests });
    } catch (error) {
      console.error("Get requests error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

requestsRouter.post(
  "/offer",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const { request_id } = req.body || {};
      const userId = req.userId!;

      if (!request_id) {
        return res.status(400).json({ error: "Request ID is required" });
      }

      const participator = await prisma.requestParticipator.create({
        data: {
          requestId: request_id,
          userId,
          status: "pending",
        },
      });

      return res.status(201).json({
        message: "Help offered successfully",
        participator,
      });
    } catch (error: any) {
      if (error.code === "P2002") {
        return res
          .status(409)
          .json({ error: "You already offered help for this request" });
      }

      console.error("Error offering help:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

requestsRouter.patch(
  "/accept-participator",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const { participator_id } = req.body;
      const userId = req.userId!;

      if (!participator_id) {
        return res.status(400).json({ error: "participatorId is required" });
      }

      const participator = await prisma.requestParticipator.findUnique({
        where: { id: participator_id },
        include: { request: true },
      });

      if (!participator) {
        return res.status(404).json({ error: "Participator not found" });
      }

      if (participator.request.userId !== userId) {
        return res
          .status(403)
          .json({ error: "Not authorized to accept participator" });
      }

      if (participator.status === "accepted") {
        return res.status(400).json({
          error: "Cannot accept a participator that has already been accepted",
        });
      }

      if (participator.status === "withdrawn") {
        return res.status(400).json({
          error: "Cannot accept a participator that has already withdrawn",
        });
      }

      if (participator.status === "rejected") {
        return res.status(400).json({
          error: "Cannot accept a participator that has already been rejected",
        });
      }

      const result = await prisma.$transaction(async (tx) => {
        const updatedParticipator = await tx.requestParticipator.update({
          where: { id: participator_id },
          data: { status: "accepted" },
        });

        let updatedRequest = null;

        const acceptedCount = await tx.requestParticipator.count({
          where: {
            requestId: participator.requestId,
            status: "accepted",
          },
        });

        if (acceptedCount === participator.request.maxHelpers) {
          updatedRequest = await tx.request.update({
            where: { id: participator.requestId },
            data: { status: "accepted" },
          });
        } else if (acceptedCount > 0) {
          updatedRequest = await tx.request.update({
            where: { id: participator.requestId },
            data: { status: "partially_accepted" },
          });
        }

        return { updatedParticipator, updatedRequest };
      });

      return res.status(200).json({
        message: `Participator accepted successfully`,
        participator: result.updatedParticipator,
        request: result.updatedRequest,
      });
    } catch (error) {
      console.error(`Error accepting participator:`, error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

requestsRouter.patch(
  "/reject-participator",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const { participator_id } = req.body;
      const userId = req.userId!;

      if (!participator_id) {
        return res.status(400).json({ error: "participatorId is required" });
      }

      const participator = await prisma.requestParticipator.findUnique({
        where: { id: participator_id },
        include: { request: true },
      });

      if (!participator) {
        return res.status(404).json({ error: "Participator not found" });
      }

      if (participator.request.userId !== userId) {
        return res
          .status(403)
          .json({ error: "Not authorized to reject this participator" });
      }

      if (participator.status === "accepted") {
        return res.status(400).json({
          error: "Cannot reject a participator that has already been accepted",
        });
      }

      if (participator.status === "withdrawn") {
        return res.status(400).json({
          error: "Cannot reject a participator that has already withdrawn",
        });
      }

      if (participator.status === "rejected") {
        return res.status(400).json({
          error: "Cannot reject a participator that has already been rejected",
        });
      }

      const updatedParticipator = await prisma.requestParticipator.update({
        where: { id: participator_id },
        data: { status: "rejected" },
      });

      return res.status(200).json({
        message: "Participator rejected successfully",
        participator: updatedParticipator,
      });
    } catch (error) {
      console.error("Error rejecting participator:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

requestsRouter.patch(
  "/cancel",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const { request_id } = req.body;

      if (!request_id) {
        return res.status(400).json({ message: "requestId is required" });
      }

      const request = await prisma.request.findUnique({
        where: { id: request_id },
      });

      if (!request) {
        return res.status(404).json({ message: "Request not found" });
      }

      if (request.userId !== userId) {
        return res
          .status(403)
          .json({ message: "Not authorized to cancel this request" });
      }

      if (request.status === "completed" || request.status === "cancelled") {
        return res
          .status(400)
          .json({ message: `Cannot cancel a ${request.status} request` });
      }

      const updatedRequest = await prisma.request.update({
        where: { id: request_id },
        data: { status: "cancelled" },
      });

      return res.status(200).json({
        message: "Request cancelled successfully",
        request: updatedRequest,
      });
    } catch (error) {
      console.error("Cancel request error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

requestsRouter.patch(
  "/moderation",
  verifyAccessToken,
  verifyRole(["admin"]),
  async (req: Request, res: Response) => {
    try {
      const { request_id, moderation_status } = req.body;

      if (!request_id || !moderation_status) {
        return res
          .status(400)
          .json({ error: "request_id and moderation_status are required" });
      }

      const updatedRequest = await prisma.request.update({
        where: { id: request_id },
        data: { moderationStatus: moderation_status },
      });

      return res.status(200).json({
        message: "Moderation status updated successfully",
        request: updatedRequest,
      });
    } catch (error: any) {
      console.error("Error updating moderation status:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

requestsRouter.patch(
  "/withdraw-offer",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const { participator_id } = req.body || {};
      const userId = req.userId!;

      if (!participator_id) {
        return res.status(400).json({ error: "participatorId is required" });
      }

      const result = await prisma.$transaction(async (tx) => {
        const participator = await tx.requestParticipator.findUnique({
          where: { id: participator_id },
          include: { request: true },
        });

        if (!participator) {
          throw new Error("Request participation not found");
        }

        if (participator.userId !== userId) {
          throw new Error("You are not allowed to withdraw this offer");
        }

        if (
          participator.status === "accepted" ||
          participator.status == "rejected"
        ) {
          throw new Error(
            "Cannot withdraw an offer that has already been accepted/rejected"
          );
        }

        const updatedParticipator = await tx.requestParticipator.update({
          where: { id: participator_id },
          data: { status: "withdrawn" },
        });

        return updatedParticipator;
      });

      return res
        .status(200)
        .json({ success: true, message: "Offer withdrawn", result });
    } catch (error: any) {
      console.error("Withdraw offer error:", error);
      return res
        .status(400)
        .json({ error: error.message || "Internal server error" });
    }
  }
);
