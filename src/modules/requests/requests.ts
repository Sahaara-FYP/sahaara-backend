import { type Request, type Response, Router } from "express";
import { verifyAccessToken } from "../../middleware/verifyAccessToken.js";
import supabase from "../../utils/supabase.js";
import prisma from "../../utils/prisma.js";
import { Prisma } from "../../../generated/prisma/index.js";
import upload from "../../middleware/multer.js";
import { createSignedUrls } from "../../utils/createSignedURL.js";
import { verifyRole } from "../../middleware/verifyRole.js";
import { keysToCamel } from "../../utils/camelize.js";

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
 * @apiBody {String="normal","high","low"} [urgencyLevel="normal"] Urgency level.
 * @apiBody {Number} locationLat Latitude of the request location (required).
 * @apiBody {Number} locationLng Longitude of the request location (required).
 * @apiBody {Boolean} [postAnonymously=false] Whether to post the request anonymously.
 * @apiBody {Boolean} [visibilityVerifiedOnly=false] Whether only verified users can see.
 * @apiBody {Boolean} [visibilityWomenOnly=false] Whether only women can see.
 * @apiBody {Number} [maxHelpers] Maximum number of helpers.
 * @apiBody {File[]} [attachments] Array of files to attach (multipart/form-data, optional).
 *
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
      urgencyLevel,
      locationLat,
      locationLng,
      postAnonymously,
      visibilityVerifiedOnly,
      visibilityWomenOnly,
      maxHelpers,
    } = req.body || {};

    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }
    if (!locationLat || !locationLng) {
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
            category,
            urgencyLevel,
            locationLat: parseFloat(locationLat),
            locationLng: parseFloat(locationLng),
            postAnonymously,
            visibilityVerifiedOnly,
            visibilityWomenOnly,
            maxHelpers,
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
 * @apiQuery {String} [locationLat] Latitude of current location (required for user).
 * @apiQuery {String} [locationLng] Longitude of current location (required for user).
 * @apiQuery {Number} [radius] Search radius in meters (optional).
 * @apiQuery {String} [category] Filter by request category.
 * @apiQuery {String=normal,high,low} [urgencyLevel] Filter by urgency level.
 * @apiQuery {String=pending,partially_accepted,accepted,completed,cancelled,expired} [status] Filter by request status.
 * @apiQuery {Boolean} [postAnonymously] Filter by anonymity.
 * @apiQuery {Boolean} [visibilityVerifiedOnly] Filter by verified-only visibility.
 * @apiQuery {Boolean} [visibilityWomenOnly] Filter by women-only visibility.
 * @apiQuery {String=clean,flagged,reviewed,blocked} [moderationStatus] Filter by moderation status.
 * @apiQuery {String} [search] Search in title and description.
 * @apiQuery {Number} [limit=20] Limit number of results.
 * @apiQuery {Number} [offset=0] Offset for pagination.
 *
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
        urgencyLevel,
        search,
        status,
        postAnonymously,
        visibilityVerifiedOnly,
        visibilityWomenOnly,
        moderationStatus,
        locationLat,
        locationLng,
        radius,
      } = req.query;

      const parseBool = (val: any) =>
        val === "true" ? true : val === "false" ? false : undefined;

      const filters: string[] = [];
      const params: any[] = [];

      if (category) {
        filters.push(`"category" = $${params.length + 1}::"RequestCategory"`);
        params.push(category);
      }
      if (urgencyLevel) {
        filters.push(`"urgency_level" = $${params.length + 1}::"UrgencyLevel"`);
        params.push(urgencyLevel);
      }
      if (status) {
        filters.push(`"status" = $${params.length + 1}::"RequestStatus"`);
        params.push(status);
      }
      if (postAnonymously) {
        filters.push(`"post_anonymously" = $${params.length + 1}`);
        params.push(parseBool(postAnonymously));
      }
      if (visibilityVerifiedOnly) {
        filters.push(`"visibility_verified_only" = $${params.length + 1}`);
        params.push(parseBool(visibilityVerifiedOnly));
      }
      if (visibilityWomenOnly) {
        filters.push(`"visibility_women_only" = $${params.length + 1}`);
        params.push(parseBool(visibilityWomenOnly));
      }
      if (moderationStatus) {
        filters.push(
          `"moderation_status" = $${params.length + 1}::"ModerationStatus"`
        );
        params.push(moderationStatus);
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
               SELECT COUNT(*)::int
               FROM "RequestParticipator" rp
               WHERE rp.request_id = sub.id
                 AND rp.status = 'accepted'
             ) AS participants_count
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

      const camelizedRequests = keysToCamel<any[]>(requests);

      for (const request of camelizedRequests) {
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
        data: camelizedRequests,
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
 * @api {patch} /requests Update a Request
 * @apiName UpdateRequest
 * @apiGroup Requests
 *
 * @apiHeader {String} Authorization Bearer token (JWT) from login.
 *
 * @apiBody {String} requestId ID of the request (required).
 * @apiBody {String} [title] Title of the request.
 * @apiBody {String} [description] Optional detailed description of the request.
 * @apiBody {String} [category] Category of the request.
 * @apiBody {String="normal","high","low"} [urgencyLevel] Urgency level.
 * @apiBody {Number} [locationLat] Latitude of the request location.
 * @apiBody {Number} [locationLng] Longitude of the request location.
 * @apiBody {Boolean} [postAnonymously] Whether to post the request anonymously.
 * @apiBody {Boolean} [visibilityVerifiedOnly] Whether only verified users can see.
 * @apiBody {Boolean} [visibilityWomenOnly] Whether only women can see.
 * @apiBody {Number} [maxHelpers] Maximum number of helpers.
 * @apiBody {File[]} [attachments] Array of files to attach (multipart/form-data, optional).
 *
 */
requestsRouter.patch(
  "/",
  verifyAccessToken,
  upload.array("attachments"),
  async (req: Request, res: Response) => {
    try {
      const { requestId } = req.body || {};
      const userId = req.userId!;

      const existingRequest = await prisma.request.findUnique({
        where: { id: requestId },
      });
      if (!existingRequest) {
        return res.status(404).json({ error: "Request not found" });
      }

      if (existingRequest.userId !== userId) {
        return res
          .status(403)
          .json({ error: "Not authorized to update this request" });
      }

      const {
        title,
        description,
        category,
        urgencyLevel,
        locationLat,
        locationLng,
        postAnonymously,
        visibilityVerifiedOnly,
        visibilityWomenOnly,
        maxHelpers,
      } = req.body || {};

      const attachments: string[] = [];

      if (req.files && Array.isArray(req.files)) {
        for (const file of req.files as Express.Multer.File[]) {
          const safeName = file.originalname.replace(/\s+/g, "_");
          const filePath = `requests/${requestId}/${Date.now()}_${safeName}`;

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

      const updatedRequest = await prisma.request.update({
        where: { id: requestId },
        data: {
          title,
          category,
          description,
          urgencyLevel,
          ...(locationLat !== undefined && {
            locationLat: parseFloat(locationLat),
          }),
          ...(locationLng !== undefined && {
            locationLng: parseFloat(locationLng),
          }),
          postAnonymously,
          visibilityVerifiedOnly,
          visibilityWomenOnly,
          maxHelpers,
          ...(attachments.length > 0 && {
            attachments: [
              ...((existingRequest.attachments as Prisma.JsonArray) || []),
              ...(attachments as Prisma.JsonArray),
            ],
          }),
        },
      });

      return res.status(200).json({
        message: "Request updated successfully",
        request: updatedRequest,
      });
    } catch (error) {
      console.error("Update request error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * @api {patch} /requests/participate Participate In Request to Help
 * @apiName Participate
 * @apiGroup Requests
 * @apiPermission authenticated
 *
 * @apiHeader {String} Authorization Bearer token (JWT Access Token).
 *
 * @apiBody {String} requestId ID of the request to participate in (required)
 *
 */
requestsRouter.post(
  "/participate",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const { requestId } = req.body || {};
      const userId = req.userId!;

      if (!requestId) {
        return res.status(400).json({ error: "Request ID is required" });
      }

      const request = await prisma.request.findUnique({
        where: { id: requestId },
      });
      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }
      if (request.userId === userId) {
        return res
          .status(400)
          .json({ error: "You cannot participate on your own request" });
      }

      const participator = await prisma.requestParticipator.create({
        data: {
          requestId,
          userId,
          status: "pending",
        },
      });

      return res.status(201).json({
        message: "Help Participation offered successfully",
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
 * @apiBody {String} participatorId ID of the participator to accept (required).
 *
 */
requestsRouter.patch(
  "/accept-participator",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const { participatorId } = req.body || {};
      const userId = req.userId!;

      if (!participatorId) {
        return res.status(400).json({ error: "participatorId is required" });
      }

      const participator = await prisma.requestParticipator.findUnique({
        where: { id: participatorId },
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
          where: { id: participatorId },
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
 * @apiBody {String} participatorId ID of the participator to reject (required).
 *
 */
requestsRouter.patch(
  "/reject-participator",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const { participatorId } = req.body || {};
      const userId = req.userId!;

      if (!participatorId) {
        return res.status(400).json({ error: "participatorId is required" });
      }

      const participator = await prisma.requestParticipator.findUnique({
        where: { id: participatorId },
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
        where: { id: participatorId },
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
 * @apiBody {String} requestId ID of the request to cancel (required).
 */
requestsRouter.patch(
  "/cancel",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const { requestId } = req.body || {};

      if (!requestId) {
        return res.status(400).json({ message: "requestId is required" });
      }

      const request = await prisma.request.findUnique({
        where: { id: requestId },
      });

      if (!request) {
        return res.status(404).json({ message: "Request not found" });
      }

      if (request.userId !== userId) {
        return res
          .status(403)
          .json({ message: "Not authorized to cancel this request" });
      }

      if (
        request.status === "completed" ||
        request.status === "cancelled" ||
        request.status === "expired"
      ) {
        return res
          .status(400)
          .json({ message: `Cannot cancel a ${request.status} request` });
      }

      const updatedRequest = await prisma.request.update({
        where: { id: requestId },
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
 * @api {patch} /requests/moderation-status Update Moderation Status
 * @apiName UpdateModerationStatus
 * @apiGroup Requests
 * @apiPermission admin
 *
 * @apiHeader {String} Authorization Bearer token (JWT Access Token).
 *
 * @apiBody {String} requestId ID of the request to update (required).
 * @apiBody {String="clean","flagged","reviewed","blocked"} moderationStatus New moderation status (required).
 *
 */
requestsRouter.patch(
  "/moderation-status",
  verifyAccessToken,
  verifyRole(["admin"]),
  async (req: Request, res: Response) => {
    try {
      const { requestId, moderationStatus } = req.body || {};

      if (!requestId || !moderationStatus) {
        return res
          .status(400)
          .json({ error: "requestId and moderationStatus are required" });
      }

      const updatedRequest = await prisma.request.update({
        where: { id: requestId },
        data: { moderationStatus },
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
 * @api {patch} /requests/withdraw-participation Withdraw Participation Offer
 * @apiName WithdrawHelpOffer
 * @apiGroup Requests
 *
 * @apiHeader {String} Authorization Bearer token (JWT Access Token).
 *
 * @apiBody {String} participatorId ID of the participator record to withdraw (required).
 */
requestsRouter.patch(
  "/withdraw-participation",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const { participatorId } = req.body || {};
      const userId = req.userId!;

      if (!participatorId) {
        return res.status(400).json({ error: "participatorId is required" });
      }

      const result = await prisma.$transaction(async (tx) => {
        const participator = await tx.requestParticipator.findUnique({
          where: { id: participatorId },
          include: { request: true },
        });

        if (!participator) {
          throw new Error("Request participation not found");
        }

        if (participator.userId !== userId) {
          throw new Error(
            "You are not allowed to withdraw this participation offer"
          );
        }

        if (participator.status !== "pending") {
          throw new Error(
            `Cannot withdraw an offer that has already been ${participator.status}`
          );
        }

        const updatedParticipator = await tx.requestParticipator.update({
          where: { id: participatorId },
          data: { status: "withdrawn" },
        });

        return updatedParticipator;
      });

      return res.status(200).json({
        message: "Participation Offer withdrawn",
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
