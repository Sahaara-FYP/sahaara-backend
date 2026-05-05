/**
 * Requests — Service Layer
 *
 * Re-Engineering Fix: Weakness 5.1 — Architectural Coupling
 *
 * Before (requests.ts, POST "/"):
 *   requestsRouter.post("/", async (req, res) => {
 *     const request = await prisma.request.create({ data: req.body });
 *     await smartMatchRequest(request.id);
 *     res.status(201).json(request);
 *   });
 *
 * The entire business logic (DB write, file upload, smart matching, group
 * room creation) lived inside the Express route handler.  Because the code
 * mixed HTTP concerns with domain logic, it was impossible to test the
 * matching algorithm independently.
 *
 * After: This Service Layer owns every piece of business logic.
 * The Controller (requests.ts) only handles:
 *   1. Parsing and validating HTTP input (via Zod schema).
 *   2. Calling the appropriate service method.
 *   3. Mapping the result to an HTTP response.
 *
 * The Service Layer calls the Repository for persistence and calls external
 * utilities (broadcast, smartMatch, chat helpers).  It has no knowledge of
 * req/res objects and can be tested in isolation with a mocked repository.
 */

import prisma from "../../utils/prisma.js";
import supabase from "../../utils/supabase.js";
import { Prisma } from "../../../generated/prisma/index.js";
import { broadcast } from "../../utils/ws.js";
import {
  smartMatchRequest,
  sendDirectNotification,
  broadcastNotification,
} from "../../services/notificationService.js";
import {
  createGroupRoom,
  onInteractionAccepted,
} from "../../utils/chatHelpers.js";
import { createSignedUrls } from "../../utils/createSignedURL.js";
import { keysToCamel } from "../../utils/camelize.js";
import {
  RequestRepository,
  type NearbyRequestsOptions,
} from "./requests.repository.js";
import { AppError } from "../../middleware/errorHandler.js";

// ---------------------------------------------------------------------------
// Input types (the controller passes validated, typed objects here)
// ---------------------------------------------------------------------------
export interface CreateRequestInput {
  userId: string;
  title: string;
  description?: string;
  category?: string;
  urgencyLevel?: "normal" | "high" | "low";
  locationLat: number;
  locationLng: number;
  postAnonymously?: boolean;
  visibilityVerifiedOnly?: boolean;
  visibilityWomenOnly?: boolean;
  maxHelpers?: number;
  files?: Express.Multer.File[];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
export class RequestService {
  /**
   * createNewHelp
   *
   * Orchestrates:
   *  1. Persisting the request record (via Prisma transaction).
   *  2. Uploading any file attachments to Supabase Storage.
   *  3. Broadcasting a WebSocket event to connected clients.
   *  4. Creating a group chat room for the request.
   *  5. Running smart proximity matching to notify nearby volunteers.
   *
   * None of these steps are tangled with HTTP parsing — the method receives
   * a plain typed object and returns a plain object.
   */
  static async createNewHelp(input: CreateRequestInput) {
    const {
      userId,
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
      files = [],
    } = input;

    // --- Step 1: Persist request + attachments in a single transaction ---
    const newRequest = await prisma.$transaction(async (tx) => {
      let request = await tx.request.create({
        data: {
          userId,
          title,
          description,
          // Prisma expects its generated RequestCategory enum; the input is
          // a plain string coming from req.body. Cast to 'any' keeps
          // the runtime value correct. Same pattern used in alerts.ts.
          category: category as any,
          urgencyLevel: urgencyLevel as any,
          locationLat,
          locationLng,
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

      // --- Step 2: Upload files to Supabase Storage ---
      const attachments: string[] = [];
      for (const file of files) {
        const safeName = file.originalname.replace(/\s+/g, "_");
        const filePath = `requests/${request.id}/${Date.now()}_${safeName}`;

        const { data, error } = await supabase.storage
          .from("attachments")
          .upload(filePath, file.buffer, {
            cacheControl: "3600",
            upsert: false,
          });

        if (error) {
          console.error("[RequestService] Supabase upload error:", error);
          continue;
        }
        attachments.push(data.path);
      }

      if (attachments.length > 0) {
        request = await tx.request.update({
          where: { id: request.id },
          data: { attachments: attachments as Prisma.InputJsonValue },
        });
      }

      return request;
    });

    // --- Step 3: WebSocket broadcast ---
    broadcast("requests_changed");

    // --- Step 4: Create group chat room (fire-and-forget, non-critical) ---
    createGroupRoom(userId, { requestId: newRequest.id }).catch((e) =>
      console.error("[RequestService] createGroupRoom error:", e),
    );

    // --- Step 5: Smart proximity matching (notify nearby volunteers) ---
    await smartMatchRequest(
      newRequest.id,
      "New Help Request Nearby",
      newRequest.title,
      newRequest.category,
      newRequest.locationLat,
      newRequest.locationLng,
      10, // 10 km radius
      20, // Top 20 best-matched volunteers
    );

    return newRequest;
  }

  /**
   * getNearbyRequests
   *
   * Delegates to the Repository for data retrieval, then applies
   * post-processing (signed URLs for attachments and profile pictures)
   * before returning the result to the controller.
   *
   * Business rule knowledge (what "nearby" means, how to sign URLs) belongs
   * here — not in the route handler.
   */
  static async getNearbyRequests(opts: NearbyRequestsOptions) {
    const rows = await RequestRepository.findNearbyRequests(opts);
    const items = keysToCamel<any[]>(rows);

    // Enrich each record with signed storage URLs
    for (const item of items) {
      if (Array.isArray(item.attachments) && item.attachments.length > 0) {
        item.attachments = await createSignedUrls(item.attachments);
      }
      const poster = item.requester || item.user;
      if (poster?.profilePictureUrl) {
        const [signed] = await createSignedUrls([poster.profilePictureUrl]);
        if (signed) poster.profilePictureUrl = signed;
      }
    }

    return items;
  }
}
