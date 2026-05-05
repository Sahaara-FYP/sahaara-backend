/**
 * Alerts — Zod Validation Schemas
 *
 * Re-Engineering Fix: Weakness 5.2 — Inconsistent Validation
 *
 * Before (alerts.ts, ~line 45):
 *   if (!title) return res.status(400).json({ error: "Title is required" });
 *   if (!locationLat || !locationLng) return res.status(400).json({ ... });
 *
 * Manual field-by-field checks are brittle: if any new field is added the
 * developer must remember to add another guard.  A missed check can produce
 * a confusing database-level error instead of a clear 400 response.
 *
 * After: A single Zod schema covers every required/optional field.
 * The schema is imported by the route and parsed with `schema.parse(req.body)`.
 * Any validation failure automatically throws a ZodError that the global
 * error handler (middleware/errorHandler.ts) converts into a structured 400
 * response — no per-route boilerplate needed.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// POST /alerts — Create Alert
// ---------------------------------------------------------------------------
export const CreateAlertSchema = z.object({
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
});

export type CreateAlertInput = z.infer<typeof CreateAlertSchema>;

// ---------------------------------------------------------------------------
// PATCH /alerts — Update Alert
// ---------------------------------------------------------------------------
export const UpdateAlertSchema = z.object({
  alertId: z.string().min(1, "Alert ID is required"),
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
});

export type UpdateAlertInput = z.infer<typeof UpdateAlertSchema>;

// ---------------------------------------------------------------------------
// PATCH /alerts/cancel & /alerts/resolve — Single ID body
// ---------------------------------------------------------------------------
export const AlertIdSchema = z.object({
  alertId: z.string().min(1, "Alert ID is required"),
});

export type AlertIdInput = z.infer<typeof AlertIdSchema>;
