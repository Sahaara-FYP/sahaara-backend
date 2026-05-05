/**
 * Auth — Zod Validation Schemas
 *
 * Re-Engineering Fix: Weakness 5.2 — Inconsistent Validation (auth.ts)
 *
 * Before (auth.ts, line 25):
 *   if (!email || !password || !full_name) {
 *     return res.status(400).json({ error: "Email and password and full name are required" });
 *   }
 *
 * A single error message covers three distinct missing fields; the client
 * cannot tell which one caused the failure.  The pattern is repeated for
 * every route without a shared contract.
 *
 * After: Zod schemas declare exactly what is required for each endpoint.
 * parse() throws a ZodError on the first violation; the global error handler
 * converts it into a structured 400 with per-field details.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// POST /auth/register
// ---------------------------------------------------------------------------
export const RegisterSchema = z.object({
  email: z.string().email("A valid email address is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  full_name: z.string().min(1, "Full name is required"),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;

// ---------------------------------------------------------------------------
// POST /auth/login
// ---------------------------------------------------------------------------
export const LoginSchema = z.object({
  identifier: z
    .string()
    .min(1, "An email, username, or phone number is required"),
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof LoginSchema>;

// ---------------------------------------------------------------------------
// POST /auth/refresh-token
// ---------------------------------------------------------------------------
export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

export type RefreshTokenInput = z.infer<typeof RefreshTokenSchema>;
