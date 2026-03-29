import { type Request, type Response, Router } from "express";
import { verifyAccessToken } from "../../middleware/verifyAccessToken.js";
import prisma from "../../utils/prisma.js";
import upload from "../../middleware/multer.js";
import { Prisma } from "../../../generated/prisma/index.js";
import supabase from "../../utils/supabase.js";
import { createSignedUrls } from "../../utils/createSignedURL.js";
import { keysToCamel } from "../../utils/camelize.js";
import { broadcast } from "../../utils/ws.js";
import { sendDirectNotification } from "../../services/notificationService.js";
import {
  closeAllRoomsForContext,
  closeDirectRoomForInteraction,
  createGroupRoom,
  onInteractionAccepted,
} from "../../utils/chatHelpers.js";

export const offersRouter = Router();

/**
 * @api {post} /offers Create a new Offer
 * @apiName CreateOffer
 * @apiGroup Offers
 *
 * @apiHeader {String} Authorization Bearer access token.
 *
 * @apiBody {String} title                 Title of the offer (required).
 * @apiBody {String} [description]         Detailed description.
 * @apiBody {String} [category="general"]  Category of the offer.
 * @apiBody {String="RESOURCE","SERVICE"} type Type of offer (required).
 * @apiBody {Number} locationLat          Latitude (required).
 * @apiBody {Number} locationLng          Longitude (required).
 * @apiBody {Number} [totalQuantity]      For RESOURCE: total quantity available.
 * @apiBody {String} [unit]               For RESOURCE: unit of measurement.
 * @apiBody {String} [availability]       For SERVICE: availability schedule.
 * @apiBody {String} [experienceDesc]     For SERVICE: experience description.
 * @apiBody {File[]} [attachments]        Optional file attachments.
 *
 */
offersRouter.post(
  "/",
  verifyAccessToken,
  upload.array("attachments"),
  async (req: Request, res: Response) => {
    const userId = req.userId!;
    const {
      title,
      description,
      category,
      type,
      locationLat,
      locationLng,
      totalQuantity,
      unit,
      availability,
      experienceDesc,
    } = req.body || {};

    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }
    if (!type || !["resource", "service"].includes(type)) {
      return res
        .status(400)
        .json({ error: "Valid type is required (resource or service)" });
    }
    if (!locationLat || !locationLng) {
      return res.status(400).json({ error: "Location is required" });
    }

    // Validate type-specific fields
    if (type === "resource" && !totalQuantity) {
      return res
        .status(400)
        .json({ error: "totalQuantity is required for resource offers" });
    }

    try {
      const newOffer = await prisma.$transaction(async (tx) => {
        let offer = await tx.offer.create({
          data: {
            userId,
            title,
            description,
            category,
            type,
            locationLat: parseFloat(locationLat),
            locationLng: parseFloat(locationLng),
            ...(type === "resource" && {
              totalQuantity: parseInt(totalQuantity),
              remainingQuantity: parseInt(totalQuantity),
              unit,
            }),
            ...(type === "service" && {
              availability,
              experienceDesc,
            }),
            attachments: [],
          },
        });

        const attachments: string[] = [];

        if (req.files && Array.isArray(req.files)) {
          for (const file of req.files as Express.Multer.File[]) {
            const safeName = file.originalname.replace(/\s+/g, "_");
            const filePath = `offers/${offer.id}/${Date.now()}_${safeName}`;

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
          offer = await tx.offer.update({
            where: { id: offer.id },
            data: { attachments: attachments as Prisma.InputJsonValue },
          });
        }

        return offer;
      });

      broadcast("offers_changed");

      // Create a group ChatRoom for this offer
      createGroupRoom(userId, { offerId: newOffer.id }).catch((e) =>
        console.error("createGroupRoom error:", e),
      );

      // Broadcast new offer
      broadcast("offers_changed", { offerId: newOffer.id });

      return res.status(201).json({
        message: "Offer created successfully",
        data: newOffer,
      });
    } catch (error) {
      console.error("Create offer error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * @api {get} /offers Get Nearby Offers
 * @apiName GetOffers
 * @apiGroup Offers
 * @apiPermission authenticated
 *
 * @apiHeader {String} Authorization Bearer token (JWT Access Token).
 *
 * @apiQuery {String} [locationLat] Latitude of current location (required for user).
 * @apiQuery {String} [locationLng] Longitude of current location (required for user).
 * @apiQuery {Number} [radius] Search radius in meters (optional).
 * @apiQuery {String} [category] Filter by offer category.
 * @apiQuery {String=RESOURCE,SERVICE} [type] Filter by offer type.
 * @apiQuery {String=ACTIVE,PAUSED,DEPLETED,COMPLETED} [status] Filter by offer status.
 * @apiQuery {String=clean,flagged,reviewed,blocked} [moderationStatus] Filter by moderation status.
 * @apiQuery {String} [search] Search in title and description.
 * @apiQuery {Number} [limit=20] Limit number of results.
 * @apiQuery {Number} [offset=0] Offset for pagination.
 *
 */
offersRouter.get(
  "/",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const {
        category,
        limit = "20",
        offset = "0",
        type,
        search,
        status,
        moderationStatus,
        locationLat,
        locationLng,
        radius,
        cursorCreatedAt,
        cursorId,
        cursorDistance,
      } = req.query;

      let { sort = "nearest" } = req.query;

      const isUser = req.role === "user";
      const isAdmin = req.role === "admin";

      const params: any[] = [];
      const filters: string[] = [];

      // Role-specific base filters
      if (isUser) {
        // Users should not see blocked items
        filters.push(
          `o.moderation_status != $${params.length + 1}::"ModerationStatus"`,
        );
        params.push("blocked");

        // User should not see their own offers
        filters.push(`o.user_id != $${params.length + 1}`);
        params.push(req.userId);

        // Users should only see active offers
        filters.push(`o.status = $${params.length + 1}::"OfferStatus"`);
        params.push("active");

        // For resource offers, only show those with remaining quantity
        filters.push(
          `(o.type = 'service' OR (o.type = 'resource' AND o.remaining_quantity > 0))`,
        );
      } else {
        // Admin can optionally filter by moderationStatus
        if (moderationStatus) {
          filters.push(
            `o.moderation_status = $${params.length + 1}::"ModerationStatus"`,
          );
          params.push(moderationStatus);
        }
      }

      // Filters from query
      if (category) {
        filters.push(`o.category = $${params.length + 1}::"RequestCategory"`);
        params.push(category);
      }
      if (type) {
        filters.push(`o.type = $${params.length + 1}::"OfferType"`);
        params.push(type);
      }
      if (status) {
        filters.push(`o.status = $${params.length + 1}::"OfferStatus"`);
        params.push(status);
      }

      if (search) {
        filters.push(
          `(o.title ILIKE $${params.length + 1} OR o.description ILIKE $${
            params.length + 2
          })`,
        );
        params.push(`%${search}%`, `%${search}%`);
      }

      const whereClause = filters.length
        ? `WHERE ${filters.join(" AND ")}`
        : "";

      // Distance expression
      let distanceExpr = "NULL";
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
          * cos(radians(CAST(o.location_lat AS DOUBLE PRECISION)))
          * cos(radians(CAST(o.location_lng AS DOUBLE PRECISION)) - radians($${params.length + 2}))
          + sin(radians($${params.length + 1}))
          * sin(radians(CAST(o.location_lat AS DOUBLE PRECISION)))
        ))`;
        params.push(lat, lng);
        needDistance = true;
      }

      // Select extra fields for user
      let selectExtra = "";
      if (isUser) {
        const userIdParamIndex = params.length + 1;
        params.push(req.userId);
        selectExtra = `,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM "OfferInteraction" oi
      WHERE oi.offer_id = sub.id
        AND oi.user_id = $${userIdParamIndex}
        AND oi.status != 'cancelled'::"InteractionStatus"
    ) THEN true ELSE false END AS "alreadyInteracted",

  (
    SELECT oi.status
    FROM "OfferInteraction" oi
    WHERE oi.offer_id = sub.id
      AND oi.user_id = $${userIdParamIndex}
    LIMIT 1
  ) AS "interactionStatus"
`;
      }

      const limitNum = Math.max(
        1,
        Math.min(100, parseInt(limit as string, 10) || 20),
      );
      const offsetNum = Math.max(0, parseInt(offset as string, 10) || 0);

      const hasCursor =
        (cursorCreatedAt && cursorId) ||
        (cursorDistance && cursorId && wantNearest);

      const fetchLimit = limitNum + 1;

      if (isAdmin) {
        sort = "latest";
      }
      let orderBy =
        "CAST(sub.distance AS double precision) ASC, sub.created_at DESC, sub.id DESC";
      let cursorCondition = "";

      if (sort === "latest") {
        orderBy = "sub.created_at DESC, sub.id DESC";
        if (hasCursor && cursorCreatedAt && cursorId) {
          params.push(cursorCreatedAt, cursorId);
          cursorCondition = ` AND (o.created_at < $${
            params.length - 1
          } OR (o.created_at = $${params.length - 1} AND o.id < $${
            params.length
          }))`;
        }
      } else if (sort === "oldest") {
        orderBy = "sub.created_at ASC, sub.id ASC";
        if (hasCursor && cursorCreatedAt && cursorId) {
          params.push(cursorCreatedAt, cursorId);
          cursorCondition = ` AND (o.created_at > $${
            params.length - 1
          } OR (o.created_at = $${params.length - 1} AND o.id > $${
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
          params.push(Number(cursorDistance), cursorId);
          cursorCondition = ` AND (CAST(${distanceExpr} AS double precision) > $${
            params.length - 1
          } OR (CAST(${distanceExpr} AS double precision) = $${
            params.length - 1
          } AND o.id < $${params.length}))`;
        }
      }

      const subWhere = whereClause ? `${whereClause}` : "";
      const subWhereWithCursor = cursorCondition
        ? subWhere
          ? subWhere.replace(/^WHERE\s*/, "WHERE (") +
            `) AND (${cursorCondition.slice(5)})`
          : `WHERE ${cursorCondition.slice(5)}`
        : subWhere;

      const innerSelect = `
        SELECT o.*, ${needDistance ? distanceExpr : "NULL"} AS distance
        FROM "Offer" o
        ${subWhereWithCursor}
      `;

      let finalQuery = "";
      let finalParams = [...params];

      if (isAdmin) {
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
                 ) AS volunteer,
                 (
                   SELECT COUNT(*)::int
                   FROM "OfferInteraction" oi
                   WHERE oi.offer_id = sub.id
                     AND oi.status = 'accepted'
                 ) AS interactions_count
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
        finalQuery = `
          SELECT sub.*, 
                 json_build_object(
                   'id', u.id,
                   'full_name', u.full_name,
                   'username', u.username,
                   'email', u.email,
                   'profile_picture_url', u.profile_picture_url
                 ) AS volunteer,
                 (
                   SELECT COUNT(*)::int
                   FROM "OfferInteraction" oi
                   WHERE oi.offer_id = sub.id
                     AND oi.status = 'accepted'::"InteractionStatus"
                 ) AS interactions_count
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

      const rows: any[] = await prisma.$queryRawUnsafe(
        finalQuery,
        ...finalParams,
      );
      const camelizedOffers = keysToCamel<any[]>(rows || []);

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
        const hasNextPage = camelizedOffers.length > limitNum;
        const items = hasNextPage
          ? camelizedOffers.slice(0, limitNum)
          : camelizedOffers;

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

        camelizedOffers.splice(0, camelizedOffers.length, ...items);
      }

      // Attach signed URLs for attachments
      for (const offer of camelizedOffers) {
        if (Array.isArray(offer.attachments) && offer.attachments.length > 0) {
          offer.attachments = await createSignedUrls(offer.attachments);
        }
      }

      return res.status(200).json({
        data: camelizedOffers,
        pagination,
        message: "Offers fetched successfully!",
      });
    } catch (error) {
      console.error("Get offers error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);
/**
 * @api {post} /offers/interact Interact with an Offer
 * @apiName InteractWithOffer
 * @apiGroup Offers
 * @apiPermission authenticated
 *
 * @apiHeader {String} Authorization Bearer token (JWT Access Token).
 *
 * @apiBody {String} offerId ID of the offer to interact with (required)
 * @apiBody {Number} [requestedQuantity] For RESOURCE: quantity requested
 * @apiBody {String} [message] For SERVICE: inquiry message
 *
 */
offersRouter.post(
  "/interact",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const { offerId, requestedQuantity, message } = req.body || {};
      const userId = req.userId!;

      if (!offerId) {
        return res.status(400).json({ error: "Offer ID is required" });
      }

      const offer = await prisma.offer.findUnique({
        where: { id: offerId },
      });

      if (!offer) {
        return res.status(404).json({ error: "Offer not found" });
      }

      if (offer.userId === userId) {
        return res
          .status(400)
          .json({ error: "You cannot interact with your own offer" });
      }

      if (offer.status !== "active") {
        return res
          .status(400)
          .json({ error: "This offer is no longer active" });
      }

      // Validate based on offer type
      if (offer.type === "resource") {
        if (!requestedQuantity) {
          return res.status(400).json({
            error: "requestedQuantity is required for resource offers",
          });
        }
        if (offer.remainingQuantity! < requestedQuantity) {
          return res
            .status(400)
            .json({ error: "Requested quantity exceeds available quantity" });
        }
      } else if (offer.type === "service") {
        if (!message) {
          return res
            .status(400)
            .json({ error: "message is required for service offers" });
        }
      }

      const existingInteraction = await prisma.offerInteraction.findUnique({
        where: {
          offerId_userId: { offerId, userId },
        },
      });

      if (
        existingInteraction &&
        !["cancelled", "rejected"].includes(existingInteraction.status)
      ) {
        return res.status(400).json({
          error: `You already have a ${existingInteraction.status} interaction with this offer`,
        });
      }

      let interaction;
      const interactionData = {
        status: "pending" as const,
        ...(offer.type === "resource" && {
          requestedQuantity: parseInt(requestedQuantity),
        }),
        ...(offer.type === "service" && { message }),
      };

      if (existingInteraction) {
        interaction = await prisma.offerInteraction.update({
          where: { id: existingInteraction.id },
          data: interactionData,
        });
      } else {
        interaction = await prisma.offerInteraction.create({
          data: {
            offerId,
            userId,
            ...interactionData,
          },
        });
      }
      broadcast("offers_changed", { offerId });

      return res.status(201).json({
        message: "Interaction created successfully",
        data: interaction,
      });
    } catch (error: any) {
      if (error.code === "P2002") {
        return res
          .status(400)
          .json({ error: "You already have an interaction with this offer" });
      }

      console.error("Error creating interaction:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * @api {patch} /offers/interaction/status Update Interaction Status
 * @apiName UpdateInteractionStatus
 * @apiGroup Offers
 * @apiPermission authenticated
 *
 * @apiHeader {String} Authorization Bearer token (JWT Access Token).
 *
 * @apiBody {String} interactionId ID of the interaction (required)
 * @apiBody {String=ACCEPTED,REJECTED,FULFILLED,CANCELLED} status New status (required)
 *
 */
offersRouter.patch(
  "/interaction/status",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const { interactionId, status } = req.body || {};
      const userId = req.userId!;

      if (!interactionId || !status) {
        return res
          .status(400)
          .json({ error: "interactionId and status are required" });
      }

      const interaction = await prisma.offerInteraction.findUnique({
        where: { id: interactionId },
        include: { offer: true },
      });

      if (!interaction) {
        return res.status(404).json({ error: "Interaction not found" });
      }

      // Only the offer owner can accept/reject, both parties can mark as fulfilled/cancelled
      if (
        ["accepted", "rejected"].includes(status) &&
        interaction.offer.userId !== userId
      ) {
        return res.status(403).json({
          error: "Only the offer owner can accept or reject interactions",
        });
      }

      if (
        ["fulfilled", "cancelled"].includes(status) &&
        interaction.offer.userId !== userId &&
        interaction.userId !== userId
      ) {
        return res
          .status(403)
          .json({ error: "Not authorized to update this interaction" });
      }

      // Handle resource quantity decrement atomically
      if (status === "accepted" && interaction.offer.type === "resource") {
        const result = await prisma.$transaction(async (tx) => {
          // Update interaction status
          const updatedInteraction = await tx.offerInteraction.update({
            where: { id: interactionId },
            data: { status },
          });

          // Decrement remaining quantity
          const updatedOffer = await tx.offer.update({
            where: { id: interaction.offerId },
            data: {
              remainingQuantity: {
                decrement: interaction.requestedQuantity!,
              },
            },
          });

          // If quantity reaches 0, mark as DEPLETED
          if (updatedOffer.remainingQuantity! <= 0) {
            await tx.offer.update({
              where: { id: interaction.offerId },
              data: { status: "depleted" },
            });
          }

          return updatedInteraction;
        });

        // Create direct room + add to group
        onInteractionAccepted(interaction.offer.userId, interaction.userId, {
          offerId: interaction.offerId,
        }).catch((e) => console.error("onInteractionAccepted error:", e));

        broadcast("offers_changed", { offerId: interaction.offerId });

        // Notify User
        await sendDirectNotification(
          interaction.userId,
          "Offer Request Accepted",
          `Your request for "${interaction.offer.title}" has been accepted!`,
          "offer_accepted",
          { offerId: interaction.offerId },
        );

        return res.status(200).json({
          message: "Interaction status updated successfully",
          interaction: result,
        });
      }

      // For SERVICE or other status updates
      const updatedInteraction = await prisma.offerInteraction.update({
        where: { id: interactionId },
        data: { status },
      });

      broadcast("offers_changed", { offerId: interaction.offerId });

      // Handle chat room lifecycle
      if (status === "accepted") {
        // Service acceptance: create direct + group membership
        onInteractionAccepted(interaction.offer.userId, interaction.userId, {
          offerId: interaction.offerId,
        }).catch((e) => console.error("onInteractionAccepted error:", e));
      } else if (status === "cancelled" || status === "rejected") {
        closeDirectRoomForInteraction(
          interaction.offer.userId,
          interaction.userId,
          { offerId: interaction.offerId },
        ).catch((e) =>
          console.error("closeDirectRoomForInteraction error:", e),
        );
      } else if (status === "fulfilled") {
        // Closing all rooms when the entire offer is fulfilled
        closeAllRoomsForContext({ offerId: interaction.offerId }).catch((e) =>
          console.error("closeAllRoomsForContext error:", e),
        );
      }

      // Notify User
      if (
        status === "accepted" ||
        status === "rejected" ||
        status === "fulfilled"
      ) {
        const title =
          status === "accepted"
            ? "Offer Request Accepted"
            : status === "rejected"
              ? "Offer Request Rejected"
              : "Offer Fulfilled";
        const body =
          status === "accepted"
            ? `Your request for "${interaction.offer.title}" has been accepted!`
            : status === "rejected"
              ? `Your request for "${interaction.offer.title}" was declined.`
              : `Your request for "${interaction.offer.title}" has been marked as fulfilled. Please rate the offerer!`;
        const type =
          status === "accepted"
            ? "offer_accepted"
            : status === "rejected"
              ? "offer_rejected"
              : "offer_fulfilled";

        await sendDirectNotification(interaction.userId, title, body, type, {
          offerId: interaction.offerId,
        });
      }

      return res.status(200).json({
        message: "Interaction status updated successfully",
        interaction: updatedInteraction,
      });
    } catch (error) {
      console.error("Update interaction status error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * @api {patch} /offers Update an Offer
 * @apiName UpdateOffer
 * @apiGroup Offers
 *
 * @apiHeader {String} Authorization Bearer access token.
 *
 * @apiBody {String} offerId ID of the offer to update (required).
 * @apiBody {String} [title] Title of the offer.
 * @apiBody {String} [description] Description.
 * @apiBody {String} [category] Category.
 * @apiBody {Number} [locationLat] Latitude.
 * @apiBody {Number} [locationLng] Longitude.
 * @apiBody {Number} [totalQuantity] For RESOURCE: update total quantity.
 * @apiBody {String} [unit] For RESOURCE: unit.
 * @apiBody {String} [availability] For SERVICE: availability.
 * @apiBody {String} [experienceDesc] For SERVICE: experience.
 * @apiBody {File[]} [attachments] New attachments.
 *
 */
offersRouter.patch(
  "/",
  verifyAccessToken,
  upload.array("attachments"),
  async (req: Request, res: Response) => {
    try {
      const { offerId } = req.body || {};
      const userId = req.userId!;

      if (!offerId) {
        return res.status(400).json({ error: "Offer ID is required" });
      }

      const existingOffer = await prisma.offer.findUnique({
        where: { id: offerId },
      });

      if (!existingOffer) {
        return res.status(404).json({ error: "Offer not found" });
      }

      if (existingOffer.userId !== userId) {
        return res
          .status(403)
          .json({ error: "Not authorized to update this offer" });
      }

      const {
        title,
        description,
        category,
        locationLat,
        locationLng,
        totalQuantity,
        unit,
        availability,
        experienceDesc,
      } = req.body || {};

      const newAttachments: string[] = [];

      if (req.files && Array.isArray(req.files)) {
        for (const file of req.files as Express.Multer.File[]) {
          const safeName = file.originalname.replace(/\s+/g, "_");
          const filePath = `offers/${offerId}/${Date.now()}_${safeName}`;

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

      const updatedOffer = await prisma.offer.update({
        where: { id: offerId },
        data: {
          title,
          description,
          category,
          ...(locationLat !== undefined && {
            locationLat: parseFloat(locationLat),
          }),
          ...(locationLng !== undefined && {
            locationLng: parseFloat(locationLng),
          }),
          ...(existingOffer.type === "resource" &&
            totalQuantity && {
              totalQuantity: parseInt(totalQuantity),
              remainingQuantity: parseInt(totalQuantity),
            }),
          ...(existingOffer.type === "resource" && unit && { unit }),
          ...(existingOffer.type === "service" &&
            availability && { availability }),
          ...(existingOffer.type === "service" &&
            experienceDesc && { experienceDesc }),
          ...(newAttachments.length > 0 && {
            attachments: [
              ...((existingOffer.attachments as Prisma.JsonArray) || []),
              ...(newAttachments as Prisma.JsonArray),
            ],
          }),
        },
      });

      broadcast("offers_changed", { offerId });

      return res.status(200).json({
        message: "Offer updated successfully",
        offer: updatedOffer,
      });
    } catch (error) {
      console.error("Update offer error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * @api {patch} /offers/status Update Offer Status
 * @apiName UpdateOfferStatus
 * @apiGroup Offers
 *
 * @apiHeader {String} Authorization Bearer access token.
 *
 * @apiBody {String} offerId ID of the offer (required).
 * @apiBody {String=ACTIVE,PAUSED,COMPLETED,CANCELLED} status New status (required).
 *
 */
offersRouter.patch(
  "/status",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const { offerId, status } = req.body || {};
      const userId = req.userId!;

      if (!offerId || !status) {
        return res
          .status(400)
          .json({ error: "offerId and status are required" });
      }

      const existingOffer = await prisma.offer.findUnique({
        where: { id: offerId },
      });

      if (!existingOffer) {
        return res.status(404).json({ error: "Offer not found" });
      }

      if (existingOffer.userId !== userId) {
        return res
          .status(403)
          .json({ error: "Not authorized to update this offer" });
      }

      const updatedOffer = await prisma.offer.update({
        where: { id: offerId },
        data: { status },
      });

      if (status === "completed" || status === "cancelled") {
        closeAllRoomsForContext({ offerId }).catch((e) =>
          console.error("closeAllRoomsForContext error:", e),
        );
      }

      broadcast("offers_changed", { offerId });

      return res.status(200).json({
        message: "Offer status updated successfully",
        offer: updatedOffer,
      });
    } catch (error) {
      console.error("Update offer status error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * @api {get} /offers/my-offers Get My Offers
 * @apiName GetMyOffers
 * @apiGroup Offers
 * @apiPermission authenticated
 *
 * @apiHeader {String} Authorization Bearer token (JWT Access Token).
 *
 */
offersRouter.get(
  "/my-offers",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;

      const offers = await prisma.offer.findMany({
        where: { userId },
        include: {
          interactions: {
            include: {
              user: {
                select: {
                  id: true,
                  fullName: true,
                  username: true,
                  email: true,
                  profilePictureUrl: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      // Attach signed URLs for attachments
      for (const offer of offers) {
        if (Array.isArray(offer.attachments) && offer.attachments.length > 0) {
          offer.attachments = await createSignedUrls(
            offer.attachments as string[],
          );
        }
      }

      return res.status(200).json({
        data: offers,
        message: "Your offers fetched successfully!",
      });
    } catch (error) {
      console.error("Get my offers error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * @api {get} /offers/my-interactions Get My Interactions
 * @apiName GetMyInteractions
 * @apiGroup Offers
 * @apiPermission authenticated
 *
 * @apiHeader {String} Authorization Bearer token (JWT Access Token).
 *
 */
offersRouter.get(
  "/my-interactions",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;

      const interactions = await prisma.offerInteraction.findMany({
        where: { userId },
        include: {
          offer: {
            include: {
              user: {
                select: {
                  id: true,
                  fullName: true,
                  username: true,
                  email: true,
                  profilePictureUrl: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      // Attach signed URLs for offer attachments
      for (const interaction of interactions) {
        if (
          Array.isArray(interaction.offer.attachments) &&
          interaction.offer.attachments.length > 0
        ) {
          interaction.offer.attachments = await createSignedUrls(
            interaction.offer.attachments as string[],
          );
        }
      }

      return res.status(200).json({
        data: interactions,
        message: "Your interactions fetched successfully!",
      });
    } catch (error) {
      console.error("Get my interactions error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * @api {get} /offers/:id Get Offer Details
 * @apiName GetOfferDetails
 * @apiGroup Offers
 * @apiPermission authenticated
 *
 * @apiHeader {String} Authorization Bearer token (JWT Access Token).
 *
 */
offersRouter.get(
  "/:id",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = req.userId!;

      if (!id) {
        return res.status(400).json({ error: "Offer ID is required" });
      }

      const offer = await prisma.offer.findUnique({
        where: { id },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              username: true,
              email: true,
              profilePictureUrl: true,
            },
          },
          interactions: {
            include: {
              user: {
                select: {
                  id: true,
                  fullName: true,
                  username: true,
                  email: true,
                  profilePictureUrl: true,
                },
              },
            },
          },
        },
      });

      if (!offer) {
        return res.status(404).json({ error: "Offer not found" });
      }

      const isOwnOffer = offer.userId === userId;

      // Attach signed URLs for attachments
      if (Array.isArray(offer.attachments) && offer.attachments.length > 0) {
        offer.attachments = await createSignedUrls(
          offer.attachments as string[],
        );
      }

      return res.status(200).json({
        ...offer,
        isOwnOffer,
      });
    } catch (error) {
      console.error("Get offer details error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);
