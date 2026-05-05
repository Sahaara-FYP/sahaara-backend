/**
 * Re-Engineering: auth.ts
 *
 * Weakness fixed: 5.2 — Inconsistent Validation
 * Before: manual "if (!email || !password || !full_name)" guards.
 * After:  Zod schemas imported from auth.schemas.ts validate every endpoint.
 *         Any schema failure throws a ZodError caught by the global
 *         errorHandler middleware, producing a structured 400 response.
 */
import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import prisma from "../../utils/prisma.js";
import bcrypt from "bcryptjs";
import { generateAccessToken, generateRefreshToken } from "./auth.service.js";
import jwt from "jsonwebtoken";
import { createSignedUrls } from "../../utils/createSignedURL.js";
import {
  RegisterSchema,
  LoginSchema,
  RefreshTokenSchema,
} from "./auth.schemas.js";

export const authRouter = Router();

// POST APIs
/**
 * @api {post} /auth/register Register
 * @apiName Register
 * @apiGroup Auth
 *
 * @apiBody {String} email User's email address (required)
 * @apiBody {String} password User's password (required)
 * @apiBody {String} full_name User's full legal name (required)
 *
 */
authRouter.post(
  "/register",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Zod replaces the previous manual if(!email || !password || !full_name) guard.
      // Any missing or invalid field throws a ZodError → handled by errorHandler.
      const { email, password, full_name } = RegisterSchema.parse(req.body);

      const existingUser = await prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        return res.status(400).json({ error: "Email already registered" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const newUser = await prisma.user.create({
        data: {
          email,
          passwordHash: hashedPassword,
          fullName: full_name,
        },
      });

      if (newUser.profilePictureUrl) {
        const [signedUrl] = await createSignedUrls([newUser.profilePictureUrl]);
        if (signedUrl) {
          newUser.profilePictureUrl = signedUrl;
        }
      }

      const { passwordHash, ...safeUser } = newUser;

      const accessToken = generateAccessToken({
        userId: newUser.id,
        role: newUser.role,
        gender: newUser.gender,
      });
      const refreshToken = generateRefreshToken({
        userId: newUser.id,
        role: newUser.role,
        gender: newUser.gender,
      });

      return res.status(201).json({
        accessToken,
        refreshToken,
        user: { ...safeUser, hasPendingVerification: false },
      });
    } catch (error) {
      // Pass to global error handler (handles ZodError → 400, AppError → specific, else 500)
      next(error);
    }
  },
);

/**
 * @api {post} /auth/login Login
 * @apiName Login
 * @apiGroup Auth
 *
 * @apiBody {String} identifier Email, username, or phone number.
 * @apiBody {String} password User's password.
 *
 */
authRouter.post(
  "/login",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Zod replaces the previous manual if(!identifier || !password) guard.
      const { identifier, password } = LoginSchema.parse(req.body);

      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { email: identifier },
            { username: identifier },
            { phoneNumber: identifier },
          ],
        },
      });

      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const pendingVerification = await prisma.verification.findFirst({
        where: { userId: user.id, status: "pending" },
      });

      const accessToken = generateAccessToken({
        userId: user.id,
        role: user.role,
        gender: user.gender,
      });
      const refreshToken = generateRefreshToken({
        userId: user.id,
        role: user.role,
        gender: user.gender,
      });

      if (user.profilePictureUrl) {
        const [signedUrl] = await createSignedUrls([user.profilePictureUrl]);
        if (signedUrl) {
          user.profilePictureUrl = signedUrl;
        }
      }

      const { passwordHash, ...safeUser } = user;

      res.json({
        message: "Login successful",
        accessToken,
        refreshToken,
        user: {
          ...safeUser,
          hasPendingVerification: !!pendingVerification,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

authRouter.post(
  "/refresh-token",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Zod replaces the previous manual if(!refreshToken) guard.
      const { refreshToken } = RefreshTokenSchema.parse(req.body);

      const decoded = jwt.verify(
        refreshToken,
        process.env.JWT_REFRESH_SECRET ||
          "fallbacktoverysecretkeyhehekeysecretveryovertofallback",
      ) as { userId: string; role: string };

      const user = await prisma.user.findUnique({
        where: { id: decoded.userId, isActive: true },
        select: { id: true, role: true, gender: true },
      });

      if (!user)
        return res
          .status(404)
          .json({ message: "User not found or deactivated" });

      const newAccessToken = generateAccessToken({
        userId: user.id,
        role: user.role,
        gender: user.gender,
      });
      const newRefreshToken = generateRefreshToken({
        userId: user.id,
        role: user.role,
        gender: user.gender,
      });

      return res.status(200).json({
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      });
    } catch (error) {
      next(error);
    }
  },
);
