/**
 * Global Error Handler Middleware
 *
 * Re-Engineering Fix: Weakness 5.3 — Standard Error Handling Issues
 *
 * Before: Every route had its own generic catch block returning a plain 500.
 * This hid system diagnostics and made debugging hard for frontend developers.
 *
 * After: A single, centralised error handler intercepts every unhandled error.
 * It produces a consistent, structured JSON envelope containing a status code,
 * a human-readable message, and (in development) a stack trace.
 * All route handlers now simply call next(error) instead of duplicating
 * res.status(500).json({ error: "Internal server error" }).
 */

import { type Request, type Response, type NextFunction } from "express";
import { ZodError } from "zod";

// ---------------------------------------------------------------------------
// Custom application error — throw this anywhere in the codebase to get a
// specific HTTP status code propagated to the client.
// ---------------------------------------------------------------------------
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

// ---------------------------------------------------------------------------
// Central error handler — must be registered AFTER all routes in index.ts
// (Express identifies it by the four-parameter signature).
// ---------------------------------------------------------------------------
export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void => {
  const isDev = process.env.NODE_ENV !== "production";

  // --- Zod validation errors (schema-based validation failures) ---
  if (err instanceof ZodError) {
    const issues = err.issues.map((e) => ({
      field: e.path.join("."),
      message: e.message,
    }));
    res.status(400).json({
      success: false,
      error: "Validation failed",
      issues,
    });
    return;
  }

  // --- Known application errors (thrown by service/repository layers) ---
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
    });
    return;
  }

  // --- Unknown / unexpected errors ---
  const message =
    err instanceof Error ? err.message : "An unexpected error occurred";

  console.error("[ErrorHandler]", err);

  res.status(500).json({
    success: false,
    error: "Internal server error",
    // Only expose the raw message and stack in non-production environments
    ...(isDev && {
      details: message,
      stack: err instanceof Error ? err.stack : undefined,
    }),
  });
};
