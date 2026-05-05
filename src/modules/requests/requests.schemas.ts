/**
 * Requests — Zod Validation Schemas
 *
 * Re-Engineering Fix: Weakness 5.2 — Inconsistent Validation
 *
 * Before (requests.ts, lines 63-68):
 *   if (!title) {
 *     return res.status(400).json({ error: "Title is required" });
 *   }
 *   if (!locationLat || !locationLng) {
 *     return res.status(400).json({ error: "Location is required" });
 *   }
 *
 * Manual guards are brittle (easy to forget fields, one generic message per
 * check, no type coercion).  Zod schemas enforce the full contract in one
 * place and produce per-field error messages automatically.
 *
 * These schemas are imported by the thin controller in requests.ts.
 * Any ZodError flows to the global errorHandler (middleware/errorHandler.ts)
 * which converts it into a structured 400 response — no per-route boilerplate.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// POST /requests — Create Help Request
// ---------------------------------------------------------------------------
export const CreateRequestSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  category: z.string().optional(),
  urgencyLevel: z.enum(["normal", "high", "low"]).optional(),
  locationLat: z
    .union([z.number(), z.string()])
    .transform((v) => parseFloat(String(v)))
    .refine((v) => !isNaN(v), {
      message: "locationLat must be a valid number",
    }),
  locationLng: z
    .union([z.number(), z.string()])
    .transform((v) => parseFloat(String(v)))
    .refine((v) => !isNaN(v), {
      message: "locationLng must be a valid number",
    }),
  postAnonymously: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === "true")
    .optional(),
  visibilityVerifiedOnly: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === "true")
    .optional(),
  visibilityWomenOnly: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === "true")
    .optional(),
  maxHelpers: z
    .union([z.number(), z.string()])
    .transform((v) => parseInt(String(v), 10))
    .refine((v) => !isNaN(v) && v > 0, {
      message: "maxHelpers must be a positive integer",
    })
    .optional(),
});

export type CreateRequestInput = z.infer<typeof CreateRequestSchema>;

// ---------------------------------------------------------------------------
// PATCH /requests — Update Help Request
// ---------------------------------------------------------------------------
export const UpdateRequestSchema = z.object({
  requestId: z.string().min(1, "Request ID is required"),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  urgencyLevel: z.enum(["normal", "high", "low"]).optional(),
  locationLat: z
    .union([z.number(), z.string()])
    .transform((v) => parseFloat(String(v)))
    .refine((v) => !isNaN(v), { message: "locationLat must be a valid number" })
    .optional(),
  locationLng: z
    .union([z.number(), z.string()])
    .transform((v) => parseFloat(String(v)))
    .refine((v) => !isNaN(v), { message: "locationLng must be a valid number" })
    .optional(),
  postAnonymously: z.boolean().optional(),
  visibilityVerifiedOnly: z.boolean().optional(),
  visibilityWomenOnly: z.boolean().optional(),
  maxHelpers: z.number().int().positive().optional(),
});

export type UpdateRequestInput = z.infer<typeof UpdateRequestSchema>;

// ---------------------------------------------------------------------------
// POST /requests/participate — Offer to help
// ---------------------------------------------------------------------------
export const ParticipateSchema = z.object({
  requestId: z.string().min(1, "Request ID is required"),
});

export type ParticipateInput = z.infer<typeof ParticipateSchema>;
