/**
 * Requests — Repository Layer
 *
 * Re-Engineering Fix: Weakness 5.4 — Database Dependency (Raw SQL)
 *
 * Before (requests.ts, line 326):
 *   distanceExpr = `(6371000 * acos(
 *     cos(radians($${params.length + 1}))
 *     * cos(radians(r.location_lat))
 *     ...
 *   ))`;
 *
 * Raw SQL strings for geographic distance calculations were embedded directly
 * inside the Express route handler.  This created a hard dependency on
 * Postgres-specific syntax (radians, acos, etc.) and made the matching
 * algorithm impossible to unit-test without a live database.
 *
 * After: The Repository Layer owns every database interaction.  The
 * Haversine formula is encapsulated in a dedicated method.
 * The Service Layer calls the repository without knowing it uses Postgres;
 * if the database is ever replaced, only this file changes.
 */

import prisma from "../../utils/prisma.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface NearbyRequestsOptions {
  userId: string;
  role: "user" | "admin" | string;
  gender?: string;
  locationLat?: number;
  locationLng?: number;
  radiusMeters?: number;
  category?: string;
  urgencyLevel?: string;
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface NearbyRequestRow {
  id: string;
  distance: number | null;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------
export class RequestRepository {
  /**
   * buildHaversineExpression
   *
   * Encapsulates the Postgres-specific Haversine formula that computes the
   * great-circle distance (in metres) between a reference point and each row.
   *
   * By isolating it here we achieve two things:
   *  1. The service layer never sees raw SQL.
   *  2. A future migration to PostGIS (ST_Distance) only requires changing
   *     this single method.
   *
   * @param latParamIndex - 1-based index of the latitude  parameter in params[]
   * @param lngParamIndex - 1-based index of the longitude parameter in params[]
   * @param tableAlias    - SQL alias for the Request table (e.g. "r")
   */
  static buildHaversineExpression(
    latParamIndex: number,
    lngParamIndex: number,
    tableAlias = "r",
  ): string {
    return `(6371000 * acos(
      LEAST(1.0, GREATEST(-1.0,
        cos(radians($${latParamIndex}))
        * cos(radians(${tableAlias}.location_lat))
        * cos(radians(${tableAlias}.location_lng) - radians($${lngParamIndex}))
        + sin(radians($${latParamIndex}))
        * sin(radians(${tableAlias}.location_lat))
      ))
    ))`;
  }

  /**
   * findNearbyRequests
   *
   * Fetches help requests filtered and sorted by geographic proximity.
   * All raw SQL is confined to this method — the service layer receives
   * a plain array of typed objects.
   */
  static async findNearbyRequests(
    opts: NearbyRequestsOptions,
  ): Promise<NearbyRequestRow[]> {
    const {
      userId,
      role,
      gender,
      locationLat,
      locationLng,
      radiusMeters,
      category,
      urgencyLevel,
      status,
      search,
      limit = 20,
      offset = 0,
    } = opts;

    const params: unknown[] = [];
    const filters: string[] = [];
    const isUser = role === "user";

    // Role-specific base filters
    if (isUser) {
      filters.push(
        `r.moderation_status != $${params.length + 1}::"ModerationStatus"`,
      );
      params.push("blocked");

      if (gender === "male") {
        filters.push(`r.visibility_women_only = false`);
      }

      filters.push(`r.status IN ('pending', 'partially_accepted')`);

      filters.push(`r.user_id != $${params.length + 1}`);
      params.push(userId);

      filters.push(`
        NOT EXISTS (
          SELECT 1 FROM "RequestParticipator" rp
          WHERE rp.request_id = r.id
            AND rp.user_id = $${params.length + 1}
            AND rp.status = 'rejected'
        )`);
      params.push(userId);
    }

    // Optional query filters
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
    if (search) {
      filters.push(
        `(r.title ILIKE $${params.length + 1} OR r.description ILIKE $${params.length + 2})`,
      );
      params.push(`%${search}%`, `%${search}%`);
    }

    const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    // Haversine distance expression (only added when coordinates are provided)
    let distanceExpr = "NULL";
    let hasDistance = false;

    if (locationLat !== undefined && locationLng !== undefined) {
      const latIdx = params.length + 1;
      const lngIdx = params.length + 2;
      distanceExpr = RequestRepository.buildHaversineExpression(latIdx, lngIdx);
      params.push(locationLat, locationLng);
      hasDistance = true;
    }

    const radiusClause =
      hasDistance && radiusMeters
        ? `HAVING ${distanceExpr} <= ${radiusMeters}`
        : "";

    const sql = `
      SELECT r.*,
             ${hasDistance ? distanceExpr : "NULL"} AS distance,
             json_build_object(
               'id',                  u.id,
               'full_name',           u.full_name,
               'username',            u.username,
               'email',               u.email,
               'profile_picture_url', u.profile_picture_url
             ) AS requester
      FROM "Request" r
      JOIN "User" u ON r.user_id = u.id
      ${whereClause}
      ${radiusClause}
      ORDER BY ${hasDistance ? "distance ASC," : ""} r.created_at DESC, r.id DESC
      LIMIT  $${params.length + 1}
      OFFSET $${params.length + 2};
    `;
    params.push(limit, offset);

    const rows: NearbyRequestRow[] = await prisma.$queryRawUnsafe(
      sql,
      ...params,
    );
    return rows;
  }

  /**
   * countNearbyRequests
   *
   * Returns the total number of rows matching the same filters (used for
   * admin offset-pagination metadata).
   */
  static async countNearbyRequests(
    opts: Omit<NearbyRequestsOptions, "limit" | "offset">,
  ): Promise<number> {
    const rows = await RequestRepository.findNearbyRequests({
      ...opts,
      limit: 100_000,
      offset: 0,
    });
    return rows.length;
  }
}
