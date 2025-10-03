import { type Request, type Response, Router } from "express";
import { verifyAccessToken } from "../../middleware/verifyAccessToken.js";
import supabase from "../../utils/supabase.js";
import prisma from "../../utils/prisma.js";
import { Prisma } from "../../../generated/prisma/index.js";
import upload from "../../middleware/multer.js";
import { createSignedUrls } from "../../utils/createSignedURL.js";
import { verifyRole } from "../../middleware/verifyRole.js";

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
 * @apiSuccess {String} message Response message.
 * @apiUse RequestModel
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
        message: "Request created successfully",
        request: newRequest,
      });
    } catch (error) {
      console.error("Create request error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * @api {get} /requests Get Nearby Requests
 * @apiName GetRequests
 * @apiGroup Requests
 * @apiPermission authenticated
 *
 * @apiHeader {String} Authorization Bearer token (JWT Access Token).
 *
 * @apiQuery {String} location_lat Latitude of current location (required).
 * @apiQuery {String} location_lng Longitude of current location (required).
 * @apiQuery {Number} [radius] Search radius in meters (optional).
 * @apiQuery {String} [category] Filter by request category.
 * @apiQuery {String=normal,high,low} [urgency_level] Filter by urgency level.
 * @apiQuery {String=pending,partially_accepted,accepted,completed,cancelled,expired} [status] Filter by request status.
 * @apiQuery {Boolean} [post_anonymously] Filter by anonymity.
 * @apiQuery {Boolean} [visibility_verified_only] Filter by verified-only visibility.
 * @apiQuery {Boolean} [visibility_women_only] Filter by women-only visibility.
 * @apiQuery {String=clean,flagged,reviewed,blocked} [moderation_status] Filter by moderation status.
 * @apiQuery {String} [search] Search in title and description.
 * @apiQuery {Number} [limit=20] Limit number of results.
 * @apiQuery {Number} [offset=0] Offset for pagination.
 *
 * @apiSuccess {String} message Success Message
 * @apiSuccess {Object[]} data List of requests.
 * @apiSuccess {Object[]} pagination Pagination Details.
 * @apiUse RequestModel
 *
 * @apiError (400 Bad Request) {String} error Location is required.
 * @apiError (500 Internal Server Error) {String} error Unexpected server error.
 */
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

      const parseBool = (val: any) =>
        val === "true" ? true : val === "false" ? false : undefined;

      const filters: string[] = [];
      const params: any[] = [];

      if (category) {
        filters.push(`"category" = $${params.length + 1}`);
        params.push(category);
      }
      if (urgency_level) {
        filters.push(`"urgency_level" = $${params.length + 1}::"UrgencyLevel"`);
        params.push(urgency_level);
      }
      if (status) {
        filters.push(`"status" = $${params.length + 1}::"RequestStatus"`);
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
        filters.push(
          `"moderation_status" = $${params.length + 1}::"ModerationStatus"`
        );
        params.push(moderation_status);
      }

      // user-specific filter (don’t show own requests)
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

      // -------------------------------------
      // LOCATION / DISTANCE only for users
      // -------------------------------------
      let distanceExpr = "0"; // fallback for admin
      let radiusFilter: number | null = null;

      if (req.role === "user") {
        if (!location_lat || !location_lng) {
          return res.status(400).json({ error: "Location is required" });
        }

        const lat = parseFloat(location_lat as string);
        const lng = parseFloat(location_lng as string);
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

      // ---------- COUNT QUERY ----------
      const countQuery = `
        SELECT COUNT(*)::int AS total
        FROM (
          SELECT r.id, ${distanceExpr} AS distance
          FROM "Request" r
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

      // ---------- DATA QUERY ----------
      const query = `
        SELECT sub.*, 
               json_build_object(
                 'id', u.id,
                 'full_name', u.full_name,
                 'username', u.username,
                 'email', u.email,
                 'profile_picture_url', u.profile_picture_url
               ) AS requester,
               (
                 SELECT COALESCE(
                   json_agg(
                     json_build_object(
                       'id', rp.id,
                       'status', rp.status,
                       'created_at', rp.created_at,
                       'updated_at', rp.updated_at,
                       'user', json_build_object(
                         'id', pu.id,
                         'full_name', pu.full_name,
                         'username', pu.username,
                         'email', pu.email,
                         'profile_picture_url', pu.profile_picture_url
                       )
                     )
                   ), '[]'
                 )
                 FROM "RequestParticipator" rp
                 JOIN "User" pu ON pu.id = rp.user_id
                 WHERE rp.request_id = sub.id
                   AND rp.status = 'accepted'
               ) AS participants
               ${selectExtra}
        FROM (
          SELECT r.*, ${distanceExpr} AS distance
          FROM "Request" r
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

      const requests: any[] = await prisma.$queryRawUnsafe(query, ...params);

      for (const request of requests) {
        if (
          Array.isArray(request.attachments) &&
          request.attachments.length > 0
        ) {
          request.attachments = await createSignedUrls(request.attachments);
        }
      }

      const page =
        Math.floor(parseInt(offset as string) / parseInt(limit as string)) + 1;
      const totalPages = Math.ceil(total / parseInt(limit as string));

      return res.status(200).json({
        data: requests,
        pagination: {
          total,
          page,
          limit: parseInt(limit as string),
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        message: "Requests fetched successfully!",
      });
    } catch (error) {
      console.error("Get requests error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * @api {patch} /requests/offer Offer Help To Request
 * @apiName OfferHelp
 * @apiGroup Requests
 * @apiPermission authenticated
 *
 * @apiHeader {String} Authorization Bearer token (JWT Access Token).
 *
 * @apiBody {String} request_id ID of the request to offer help to (required).
 *
 * @apiSuccess {String} message Success message.
 * @apiUse RequestParticipatorModel
 *
 * @apiError (400 Bad Request) {String} error Already offered help to this request.
 * @apiError (500 Internal Server Error) {String} error Unexpected server error.
 */
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
          .status(400)
          .json({ error: "You already offered help for this request" });
      }

      console.error("Error offering help:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * @api {patch} /requests/accept-participator Accept a Participator
 * @apiName AcceptParticipator
 * @apiGroup Requests
 * @apiPermission authenticated
 *
 * @apiHeader {String} Authorization Bearer token (JWT Access Token).
 *
 * @apiBody {String} participator_id ID of the participator to accept (required).
 *
 * @apiSuccess {String} message Success message.
 * @apiUse RequestModel
 * @apiUse RequestParticipatorModel
 *
 * @apiError (400 Bad Request) {String} error Cannot accept participator (already accepted/withdrawn/rejected).
 * @apiError (403 Forbidden) {String} error Not authorized to accept participator of this request.
 * @apiError (404 Not Found) {String} error Participator not found.
 * @apiError (500 Internal Server Error) {String} error Unexpected server error.
 */
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
        const acceptedCount = await tx.requestParticipator.count({
          where: { requestId: participator.requestId, status: "accepted" },
        });

        if (acceptedCount >= participator.request.maxHelpers!) {
          throw new Error("Max helpers already accepted");
        }

        const updatedParticipator = await tx.requestParticipator.update({
          where: { id: participator_id },
          data: { status: "accepted" },
        });

        const newAcceptedCount = acceptedCount + 1;
        let updatedRequest = null;

        if (newAcceptedCount === participator.request.maxHelpers) {
          updatedRequest = await tx.request.update({
            where: { id: participator.requestId },
            data: { status: "accepted" },
          });
        } else if (newAcceptedCount > 0) {
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

/**
 * @api {patch} /requests/reject-participator Reject a Participator
 * @apiName RejectParticipator
 * @apiGroup Requests
 * @apiPermission authenticated
 *
 * @apiHeader {String} Authorization Bearer token (JWT Access Token).
 *
 * @apiBody {String} participator_id ID of the participator to reject (required).
 *
 * @apiSuccess {String} message Success message.
 * @apiUse RequestParticipatorModel
 *
 * @apiError (400 Bad Request) {String} error Cannot reject participator (already accepted/withdrawn/rejected).
 * @apiError (403 Forbidden) {String} error Not authorized to reject participator of this request.
 * @apiError (404 Not Found) {String} error Participator not found.
 * @apiError (500 Internal Server Error) {String} error Unexpected server error.
 */
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

/**
 * @api {patch} /requests/cancel Cancel a Request
 * @apiName CancelRequest
 * @apiGroup Requests
 * @apiPermission authenticated
 *
 * @apiHeader {String} Authorization Bearer token (JWT Access Token).
 *
 * @apiBody {String} request_id ID of the request to cancel (required).
 *
 * @apiSuccess {String} message Response message.
 * @apiUse RequestModel
 *
 * @apiError (400 Bad Request) {String} message Request cannot be cancelled (already completed/cancelled).
 * @apiError (403 Forbidden) {String} message Not authorized to cancel this request.
 * @apiError (404 Not Found) {String} message Request not found.
 * @apiError (500 Internal Server Error) {String} message Unexpected error.
 */
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

/**
 * @api {patch} /requests/moderation Update Moderation Status
 * @apiName UpdateModerationStatus
 * @apiGroup Requests
 * @apiPermission admin
 *
 * @apiHeader {String} Authorization Bearer token (JWT Access Token).
 *
 * @apiBody {String} request_id ID of the request to update (required).
 * @apiBody {String="clean","flagged","reviewed","blocked"} moderation_status New moderation status (required).
 *
 * @apiSuccess {String} message Response message.
 * @apiUse RequestModel
 *
 * @apiError {String} error Error message if update fails.
 */
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

/**
 * @api {patch} /requests/withdraw-offer Withdraw Offer
 * @apiName WithdrawOffer
 * @apiGroup Requests
 *
 * @apiHeader {String} Authorization Bearer token (JWT Access Token).
 *
 * @apiBody {String} participator_id ID of the participator record to withdraw (required).
 *
 * @apiSuccess {String} message Response message.
 * @apiUse RequestParticipatorModel
 *
 * @apiError {String} error Error message describing why withdrawal failed.
 */
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

      return res.status(200).json({
        message: "Offer withdrawn",
        participator: result,
      });
    } catch (error: any) {
      console.error("Withdraw offer error:", error);
      return res
        .status(400)
        .json({ error: error.message || "Internal server error" });
    }
  }
);
