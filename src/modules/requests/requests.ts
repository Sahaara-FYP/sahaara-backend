import { type Request, type Response, Router } from "express";
import { verifyAccessToken } from "../../middleware/verifyAccessToken.js";
import supabase from "../../utils/supabase.js";
import prisma from "../../utils/prisma.js";
import { Prisma } from "../../../generated/prisma/index.js";
import upload from "../../middleware/multer.js";
import { createSignedUrls } from "../../utils/createSignedURL.js";
import { verifyRole } from "../../middleware/verifyRole.js";
import { keysToCamel } from "../../utils/camelize.js";
import { broadcast } from "../../utils/ws.js";
import {
  smartMatchRequest,
  sendDirectNotification,
  broadcastNotification,
} from "../../services/notificationService.js";

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
            expiresAt: new Date(
              Date.now() +
                (urgencyLevel === "high" ? 2 : 7) * 24 * 60 * 60 * 1000,
            ),
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

      broadcast("requests_changed");

      // Smart Matching & Proximity Broadcast (Top 20 users within 10km radius)
      await smartMatchRequest(
        newRequest.id,
        "New Help Request Nearby",
        `${newRequest.title} needs your help!`,
        newRequest.category,
        newRequest.locationLat,
        newRequest.locationLng,
        10, // 10km radius
        20, // Limit to Top 20 for quality matching
      );

      return res.status(201).json({
        message: "Request created successfully",
        request: newRequest,
      });
    } catch (error) {
      console.error("Create request error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
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
// GET /requests
requestsRouter.get(
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
        postAnonymously,
        visibilityVerifiedOnly,
        visibilityWomenOnly,
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
        // users should not see blocked items (unless you want otherwise)
        filters.push(
          `r.moderation_status != $${params.length + 1}::"ModerationStatus"`,
        );
        params.push("blocked");

        if (req.gender === "male") {
          filters.push(`r.visibility_women_only = false`);
        }

        filters.push(`r.status IN ('pending', 'partially_accepted')`);

        // user should not see their own requests
        filters.push(`r.user_id != $${params.length + 1}`);
        params.push(req.userId);

        //user should not see those to which he has been rejected
        filters.push(`
  NOT EXISTS (
    SELECT 1
    FROM "RequestParticipator" rp
    WHERE rp.request_id = r.id
      AND rp.user_id = $${params.length + 1}
      AND rp.status = 'rejected'
  )
`);
        params.push(req.userId);
      } else {
        // admin can optionally filter by moderationStatus passed via query
        if (moderationStatus) {
          filters.push(
            `r.moderation_status = $${params.length + 1}::"ModerationStatus"`,
          );
          params.push(moderationStatus);
        }
      }

      // --- filters from query ---
      if (category) {
        filters.push(`r.category = $${params.length + 1}::"RequestCategory"`);
        params.push(category);
      }
      if (urgencyLevel) {
        filters.push(`r.urgency_level = $${params.length + 1}::"UrgencyLevel"`);
        params.push(urgencyLevel);
      }
      if (status) {
        filters.push(`r.status = $${params.length + 1}::"RequestStatus"`);
        params.push(status);
      }
      if (postAnonymously) {
        filters.push(`r.post_anonymously = $${params.length + 1}`);
        params.push(parseBool(postAnonymously));
      }
      if (visibilityVerifiedOnly) {
        filters.push(`r.visibility_verified_only = $${params.length + 1}`);
        params.push(parseBool(visibilityVerifiedOnly));
      }
      if (visibilityWomenOnly) {
        filters.push(`r.visibility_women_only = $${params.length + 1}`);
        params.push(parseBool(visibilityWomenOnly));
      }

      if (search) {
        filters.push(
          `(r.title ILIKE $${params.length + 1} OR r.description ILIKE $${
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

      // If user and location is required for nearest or radius filtering, validate location
      const wantNearest = sort === "nearest";
      const hasLocation = locationLat && locationLng;

      if (isUser && !hasLocation && (wantNearest || radius)) {
        // require location if nearest sort or radius filter is requested by user
        return res.status(400).json({
          error:
            "locationLat and locationLng are required for nearest sorting / radius filtering",
        });
      }

      if (hasLocation) {
        const lat = parseFloat(locationLat as string);
        const lng = parseFloat(locationLng as string);
        radiusFilter = radius ? parseFloat(radius as string) : null;

        // We'll push lat,lng into params only once (used by distance expression placeholders)
        // Use current params length to generate placeholders in SQL string correctly.
        // We push lat then lng (in that order).
        // distance in meters (Haversine)
        distanceExpr = `(6371000 * acos(
          cos(radians($${params.length + 1}))
          * cos(radians(r.location_lat))
          * cos(radians(r.location_lng) - radians($${params.length + 2}))
          + sin(radians($${params.length + 1}))
          * sin(radians(r.location_lat))
        ))`;
        params.push(lat, lng);
        needDistance = true;
      }

      // --- select extra fields for user (alreadyOffered) ---
      let selectExtra = "";
      if (isUser) {
        // Use parameter binding for req.userId to avoid string interpolation
        // We'll push userId temporary here and re-use its index in the SELECT via literal (safer to push separately)
        // But simpler: we'll include the userId value directly as text in the subquery params (it was in original code)
        // Safer approach: pass as param - but $ placeholders inside SELECT subquery require referencing outer params
        // We'll add a param now and then reference its index in the SELECT string.
        const userIdParamIndex = params.length + 1;
        params.push(req.userId);
        selectExtra = `,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM "RequestParticipator" rp
      WHERE rp.request_id = sub.id
      AND rp.status = 'pending'::"ParticipationStatus"
        AND rp.user_id = $${userIdParamIndex}
    ) THEN true ELSE false END AS "alreadyOffered",

  (
    SELECT rp.status
    FROM "RequestParticipator" rp
    WHERE rp.request_id = sub.id
      AND rp.user_id = $${userIdParamIndex}
    LIMIT 1
  ) AS "offerStatus"
`;
      }

      // --- Build ordering and cursor logic ---
      // Support sorts: latest (created_at DESC), oldest (created_at ASC), nearest (distance ASC)
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
          cursorCondition = ` AND (r.created_at < $${
            params.length - 1
          } OR (r.created_at = $${params.length - 1} AND r.id < $${
            params.length
          }))`;
        }
      } else if (sort === "oldest") {
        orderBy = "sub.created_at ASC, sub.id ASC";
        if (hasCursor && cursorCreatedAt && cursorId) {
          // next page for ASC: rows where (created_at, id) > (cursorCreatedAt, cursorId)
          params.push(cursorCreatedAt, cursorId);
          cursorCondition = ` AND (r.created_at > $${
            params.length - 1
          } OR (r.created_at = $${params.length - 1} AND r.id > $${
            params.length
          }))`;
        }
      } else if (sort === "nearest") {
        // For nearest, we need distance in the sub select and order by distance asc, then created_at desc for tie-breaker
        orderBy = "sub.distance ASC, sub.created_at DESC, sub.id DESC";
        // require location (handled earlier)
        if (!needDistance) {
          return res.status(400).json({
            error: "locationLat & locationLng required for nearest sort",
          });
        }

        if (hasCursor && cursorDistance && cursorId) {
          // cursorDistance provided indicates where we left off
          // For ASC distance: next rows have (distance, id) > (cursorDistance, cursorId)
          // i.e., distance > cursorDistance OR (distance = cursorDistance AND id < cursorId) depending tie break;
          // To keep tie-breaker deterministic, we will use: (distance > cursorDistance) OR (distance = cursorDistance AND r.id < cursorId)
          // push cursorDistance then cursorId
          params.push(Number(cursorDistance), cursorId);
          cursorCondition = ` AND (CAST(${distanceExpr} AS double precision) > $${
            params.length - 1
          } OR (CAST(${distanceExpr} AS double precision) = $${
            params.length - 1
          } AND a.id < $${params.length}))`;
        }
      }

      // --- Build the subquery with filters + optional cursorCondition + distance expression ---
      // Note: cursorCondition references r and distanceExpr placeholders which rely on params positions above
      const subWhere = whereClause ? `${whereClause}` : "";
      // If cursorCondition exists, append it to the subWhere with AND (ensure proper handling if subWhere is empty)
      const subWhereWithCursor = cursorCondition
        ? subWhere
          ? subWhere.replace(/^WHERE\s*/, "WHERE (") +
            `) AND (${cursorCondition.slice(5)})` // hack to keep single WHERE
          : `WHERE ${cursorCondition.slice(5)}`
        : subWhere;

      // We'll construct the primary SELECT. Use distanceExpr (if needed) as distance.
      const innerSelect = `
        SELECT r.*, ${needDistance ? distanceExpr : "NULL"} AS distance
        FROM "Request" r
        ${subWhereWithCursor}
      `;

      // --- For admin we want offset pagination and total count. For users infinite scroll, we return cursors. ---
      let finalQuery = "";
      let finalParams = [...params];

      if (isAdmin) {
        // Admin: do offset pagination and include total count (useful for admin UI)
        // count query
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
                 ) AS requester,
                 (
                   SELECT COUNT(*)::int
                   FROM "RequestParticipator" rp
                   WHERE rp.request_id = sub.id
                     AND rp.status = 'accepted'
                 ) AS participants_count
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
        // Use cursor fetch: fetch limit + 1 for hasNextPage detection
        finalQuery = `
          SELECT sub.*, 
                 json_build_object(
                   'id', u.id,
                   'full_name', u.full_name,
                   'username', u.username,
                   'email', u.email,
                   'profile_picture_url', u.profile_picture_url
                 ) AS user,
                 (
                   SELECT COUNT(*)::int
                   FROM "RequestParticipator" rp
                   WHERE rp.request_id = sub.id
                     AND rp.status = 'accepted'
                 ) AS participants_count
                 ${selectExtra}
          FROM (
            ${innerSelect}
          ) AS sub
          JOIN "User" u ON sub.user_id = u.id
          ${radiusFilter ? `WHERE sub.distance <= ${radiusFilter}` : ""}
          ORDER BY ${orderBy}
          LIMIT $${finalParams.length + 1};
        `;
        finalParams.push(fetchLimit); // limit+1 for hasNextPage
      }

      // --- Execute query ---
      const rows: any[] = await prisma.$queryRawUnsafe(
        finalQuery,
        ...finalParams,
      );
      // rows are raw SQL objects (snake_case keys). Convert to camelCase as you previously did.
      const camelizedRequests = keysToCamel<any[]>(rows || []);

      // --- If using cursor-based (user), determine hasNextPage and trim results ---
      let pagination: any = {};
      if (isAdmin) {
        // compute page info for admin
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
        // user
        const hasNextPage = camelizedRequests.length > limitNum;
        const items = hasNextPage
          ? camelizedRequests.slice(0, limitNum)
          : camelizedRequests;

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

        // replace camelizedRequests with trimmed items
        camelizedRequests.splice(0, camelizedRequests.length, ...items);
      }

      // --- Attach signed URLs for attachments if present (async loop) ---
      for (const request of camelizedRequests) {
        if (
          Array.isArray(request.attachments) &&
          request.attachments.length > 0
        ) {
          request.attachments = await createSignedUrls(request.attachments);
        }
      }

      return res.status(200).json({
        data: camelizedRequests,
        pagination,
        message: "Requests fetched successfully!",
      });
    } catch (error) {
      console.error("Get requests error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
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
      broadcast("requests_changed", { requestId });
      return res.status(200).json({
        message: "Request updated successfully",
        request: updatedRequest,
      });
    } catch (error) {
      console.error("Update request error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
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
        include: {
          participators: {
            where: { status: "accepted" },
          },
        },
      });
      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }
      if (request.userId === userId) {
        return res
          .status(400)
          .json({ error: "You cannot participate on your own request" });
      }

      const acceptedCount = request.participators.length;
      if (acceptedCount >= (request.maxHelpers || 1)) {
        return res
          .status(400)
          .json({ error: "Request already has the maximum number of helpers" });
      }

      const existingParticipation = await prisma.requestParticipator.findUnique(
        {
          where: {
            unique_request_user: { requestId, userId },
          },
        },
      );

      let participator;
      if (existingParticipation) {
        if (existingParticipation?.status !== "withdrawn") {
          return res.status(400).json({
            error: `You cannot participate again on a/an ${existingParticipation?.status} help offer`,
          });
        }
        participator = await prisma.requestParticipator.update({
          data: {
            status: "pending",
          },
          where: {
            unique_request_user: { requestId, userId },
          },
        });
      } else {
        participator = await prisma.requestParticipator.create({
          data: {
            requestId,
            userId,
            status: "pending",
          },
        });
      }
      broadcast("requests_changed", { requestId });

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
  },
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
      broadcast("requests_changed", { requestId: participator.requestId });

      // Notify the helper that their participation was accepted
      await sendDirectNotification(
        participator.userId,
        "Help Offer Accepted",
        `Your offer to help with "${participator.request.title}" was accepted!`,
        "request_accepted",
        { requestId: participator.requestId },
      );

      return res.status(200).json({
        message: `Participator accepted successfully`,
        participator: result.updatedParticipator,
        request: result.updatedRequest,
      });
    } catch (error) {
      console.error(`Error accepting participator:`, error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
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
      broadcast("requests_changed", { requestId: participator.requestId });
      return res.status(200).json({
        message: "Participator rejected successfully",
        participator: updatedParticipator,
      });
    } catch (error) {
      console.error("Error rejecting participator:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * @api {patch} /requests/complete Complete a Request
 * @apiName CompleteRequest
 * @apiGroup Requests
 * @apiPermission authenticated
 *
 * @apiHeader {String} Authorization Bearer token (JWT Access Token).
 *
 * @apiBody {String} requestId ID of the request to cancel (required).
 */
requestsRouter.patch(
  "/complete",
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
          .json({ message: "Not authorized to complete this request" });
      }

      if (request.status !== "accepted") {
        return res.status(400).json({
          message: `Cannot complete a ${request.status.replace(
            "_",
            " ",
          )} request`,
        });
      }

      const updatedRequest = await prisma.request.update({
        where: { id: requestId },
        data: { status: "completed" },
      });
      broadcast("requests_changed", { requestId });
      return res.status(200).json({
        message: "Request marked as completed successfully",
        request: updatedRequest,
      });
    } catch (error) {
      console.error("Complete request error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  },
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
      broadcast("requests_changed", { requestId });
      return res.status(200).json({
        message: "Request cancelled successfully",
        request: updatedRequest,
      });
    } catch (error) {
      console.error("Cancel request error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  },
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
      broadcast("requests_changed", { requestId });
      return res.status(200).json({
        message: "Moderation status updated successfully",
        request: updatedRequest,
      });
    } catch (error: any) {
      console.error("Error updating moderation status:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  },
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
      const { requestId } = req.body || {};
      const userId = req.userId!;

      if (!requestId) {
        return res.status(400).json({ error: "Request ID is required" });
      }

      const result = await prisma.$transaction(async (tx) => {
        const participator = await tx.requestParticipator.findUnique({
          where: { unique_request_user: { requestId, userId } },
          include: { request: true },
        });

        if (!participator) {
          throw new Error("Request participation not found");
        }

        if (participator.userId !== userId) {
          throw new Error(
            "You are not allowed to withdraw this participation offer",
          );
        }

        if (participator.status !== "pending") {
          throw new Error(
            `Cannot withdraw an offer that has already been ${participator.status}`,
          );
        }

        const updatedParticipator = await tx.requestParticipator.update({
          where: { unique_request_user: { requestId, userId } },
          data: { status: "withdrawn" },
        });

        return updatedParticipator;
      });
      broadcast("requests_changed", { requestId });
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
  },
);

/**
 * @api {get} /requests/me Get User's Own Requests (Paginated)
 * @apiName GetUserRequestsPaginated
 * @apiGroup Requests
 *
 * @apiHeader {String} Authorization Bearer token (JWT Access Token).
 *
 * @apiQuery {String} [cursor] The ID of the last fetched request (for pagination).
 * @apiQuery {Number} [limit=20] Number of requests to fetch per page.
 *
 */
requestsRouter.get(
  "/me",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const limit = parseInt(req.query.limit as string) || 20;

      const cursorCreatedAt = req.query.cursorCreatedAt as string | undefined;
      const cursorId = req.query.cursorId as string | undefined;

      const requests = await prisma.request.findMany({
        where: { userId },
        include: {
          participators: {
            include: { user: true },
          },
          _count: { select: { participators: true } },
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

      for (const request of requests) {
        if (
          Array.isArray(request.attachments) &&
          request.attachments.length > 0
        ) {
          request.attachments = await createSignedUrls(
            request.attachments as string[],
          );
        }
      }

      const hasExtra = requests.length > limit;
      if (hasExtra) {
        requests.pop();
      }
      const lastItem = requests[requests.length - 1];
      const nextCursor = lastItem
        ? { id: lastItem.id, createdAt: lastItem.createdAt.toISOString() }
        : null;

      return res.status(200).json({
        message: "User's requests fetched successfully",
        data: requests,
        nextCursor,
      });
    } catch (error: any) {
      console.error("Fetch user requests error:", error);
      return res
        .status(500)
        .json({ error: error.message || "Internal server error" });
    }
  },
);

/**
 * @api {get} /requests/participations/me Get User's Participated Requests (Paginated)
 * @apiName GetUserParticipationsPaginated
 * @apiGroup Requests
 *
 * @apiHeader {String} Authorization Bearer token (JWT Access Token).
 *
 * @apiQuery {String} [cursor] The ID of the last fetched participation (for pagination).
 * @apiQuery {Number} [limit=20] Number of requests to fetch per page.
 */
requestsRouter.get(
  "/participations/me",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const limit = parseInt(req.query.limit as string) || 20;

      const cursorCreatedAt = req.query.cursorCreatedAt as string | undefined;
      const cursorId = req.query.cursorId as string | undefined;

      const participations = await prisma.requestParticipator.findMany({
        where: { userId },
        include: {
          request: {
            include: {
              participators: {
                include: { user: true },
                where: { status: "accepted" },
              },
              _count: {
                select: {
                  participators: {
                    where: { status: "accepted" },
                  },
                },
              },
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

      const hasExtra = participations.length > limit;
      if (hasExtra) participations.pop();

      const lastItem = participations[participations.length - 1];
      const nextCursor = lastItem
        ? { id: lastItem.id, createdAt: lastItem.createdAt.toISOString() }
        : null;

      const requests = participations.map((p) => {
        const { passwordHash, ...safeUser } = p.request.user;
        return {
          ...p.request,
          user: safeUser,
          offerStatus: p.status,
          alreadyOffered: true,
        };
      });
      console.log("🚀 ~ requests:", requests);

      return res.status(200).json({
        message: "User's participated requests fetched successfully",
        data: requests,
        nextCursor,
      });
    } catch (error: any) {
      console.error("Fetch user participations error:", error);
      return res
        .status(500)
        .json({ error: error.message || "Internal server error" });
    }
  },
);

/**
 * @api {get} /requests/:requestId Get Request by ID
 * @apiName GetRequestById
 * @apiGroup Requests
 *
 * @apiHeader {String} Authorization Bearer token (JWT Access Token).
 *
 * @apiParam {String} requestId ID of the request to fetch.
 *
 */
requestsRouter.get(
  "/:requestId",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const { requestId } = req.params;
      const userId = req.userId!;

      if (!requestId) {
        return res.status(400).json({ error: "Request ID is required" });
      }

      const request = await prisma.request.findUnique({
        where: { id: requestId },
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
          participators: {
            include: {
              user: {
                select: {
                  id: true,
                  fullName: true,
                  username: true,
                  email: true,
                  phoneNumber: true,
                  profilePictureUrl: true,
                  gender: true,
                  isVerified: true,
                },
              },
            },
          },
          _count: {
            select: {
              participators: true,
            },
          },
        },
      });

      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      // Handle attachments signed URLs
      if (
        Array.isArray(request.attachments) &&
        request.attachments.length > 0
      ) {
        request.attachments = await createSignedUrls(
          request.attachments as string[],
        );
      }

      // Add isOwnRequest field
      const isOwnRequest = request.userId === userId;

      // Find current user's participation
      const myParticipation = request.participators.find(
        (p) => p.userId === userId,
      );

      // Match list view logic: alreadyOffered is true if pending
      const alreadyOffered = myParticipation?.status === "pending";
      const offerStatus = myParticipation?.status || null;

      // Calculate accepted helpers count (matching participantsCount in list view)
      const participantsCount = request.participators.filter(
        (p) => p.status === "accepted",
      ).length;

      return res.status(200).json({
        ...request,
        isOwnRequest,
        alreadyOffered,
        offerStatus,
        participantsCount,
      });
    } catch (error: any) {
      console.error("Fetch request by ID error:", error);
      return res
        .status(500)
        .json({ error: error.message || "Internal server error" });
    }
  },
);

/**
 * @api {patch} /requests/renew Renew a Request
 * @apiName RenewRequest
 * @apiGroup Requests
 * @apiPermission authenticated
 *
 * @apiHeader {String} Authorization Bearer token (JWT Access Token).
 *
 * @apiBody {String} requestId ID of the request to renew (required).
 */
requestsRouter.patch(
  "/renew",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const { requestId } = req.body || {};

      if (!requestId) {
        return res.status(400).json({ error: "requestId is required" });
      }

      const request = await prisma.request.findUnique({
        where: { id: requestId },
      });

      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      if (request.userId !== userId) {
        return res
          .status(403)
          .json({ error: "Not authorized to renew this request" });
      }

      // Only allow renewal if expired or pending/partially_accepted
      if (
        !["pending", "partially_accepted", "expired"].includes(request.status)
      ) {
        return res.status(400).json({
          error: `Cannot renew a ${request.status} request`,
        });
      }

      // Set new expiry: 7 days for normal, 2 days for high urgency
      const newExpiresAt = new Date(
        Date.now() +
          (request.urgencyLevel === "high" ? 2 : 7) * 24 * 60 * 60 * 1000,
      );

      const updatedRequest = await prisma.request.update({
        where: { id: requestId },
        data: {
          expiresAt: newExpiresAt,
          status: request.status === "expired" ? "pending" : request.status,
        },
      });

      broadcast("requests_changed", { requestId });

      return res.status(200).json({
        message: "Request renewed successfully",
        request: updatedRequest,
      });
    } catch (error: any) {
      console.error("Renew request error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);
