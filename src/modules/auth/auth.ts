import { Router, type Request, type Response } from "express";
import prisma from "../../utils/prisma.js";
import bcrypt from "bcryptjs";
import { generateAccessToken, generateRefreshToken } from "./auth.service.js";

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
 * @apiSuccess {Object} user Created user object
 * @apiSuccess {String} user.id Unique ID of the new user
 * @apiSuccess {String} user.email Email of the user
 * @apiSuccess {String} user.role Role of the user ('user', 'admin', 'moderator')
 * @apiSuccess {Boolean} user.isActive Whether the account is active
 * @apiSuccess {String} user.createdAt Timestamp when the user was created (ISO 8601 string)
 * @apiSuccess {Boolean} user.completedOnboarding Whether the user has completed onboarding
 *
 * @apiError {String} error Error message if registration fails or validation fails
 */
authRouter.post("/register", async (req: Request, res: Response) => {
  try {
    const { email, password, full_name } = req.body || {};

    if (!email || !password || !full_name) {
      return res
        .status(400)
        .json({ error: "Email and password and full name are required" });
    }

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
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        completedOnboarding: true,
      },
    });

    return res.status(201).json({ user: newUser });
  } catch (error) {
    console.error("Register error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * @api {post} /auth/login Login
 * @apiName Login
 * @apiGroup Auth
 *
 * @apiBody {String} identifier Email, username, or phone number.
 * @apiBody {String} password User's password.
 *
 * @apiSuccess {Boolean} success Indicates login success.
 * @apiSuccess {String} message Response message.
 * @apiSuccess {String} accessToken JWT access token.
 * @apiSuccess {String} refreshToken JWT refresh token.
 * @apiSuccess {Object} user User object (passwordHash excluded)
 * @apiSuccess {String} user.id User's unique ID
 * @apiSuccess {String} user.fullName Full legal name
 * @apiSuccess {String} [user.username] Public username (nullable)
 * @apiSuccess {String} user.email Email
 * @apiSuccess {String} [user.phoneNumber] Phone number (nullable)
 * @apiSuccess {String} [user.gender] Gender ('male', 'female', nullable)
 * @apiSuccess {String} [user.dateOfBirth] Date of birth (ISO 8601 string, nullable)
 * @apiSuccess {String} [user.profilePictureUrl] Profile picture URL (nullable)
 * @apiSuccess {String} [user.bio] Short bio (nullable)
 * @apiSuccess {String} user.verificationStatus Verification status ('unverified', 'pending', 'verified', 'rejected')
 * @apiSuccess {String} [user.cnicNumber] CNIC number (nullable)
 * @apiSuccess {String} [user.cnicImageUrl] CNIC image URL (nullable)
 * @apiSuccess {String} [user.selfieUrl] Selfie URL (nullable)
 * @apiSuccess {Object} [user.skills] Array or JSON object of skills/services (nullable)
 * @apiSuccess {String} user.role User role ('user', 'admin', 'moderator')
 * @apiSuccess {Boolean} user.isActive Whether account is active
 * @apiSuccess {String} user.createdAt Creation timestamp (ISO 8601 string)
 * @apiSuccess {String} user.updatedAt Last updated timestamp (ISO 8601 string)
 * @apiSuccess {Boolean} user.completedOnboarding Whether profile onboarding is complete
 *
 * @apiError {String} error Error message
 */
authRouter.post("/login", async (req: Request, res: Response) => {
  try {
    const { identifier, password } = req.body || {};

    if (!identifier || !password) {
      return res
        .status(400)
        .json({ error: "Identifier and password are required" });
    }

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

    const accessToken = generateAccessToken({
      userId: user.id,
      role: user.role,
    });
    const refreshToken = generateRefreshToken({
      userId: user.id,
      role: user.role,
    });

    const { passwordHash, ...safeUser } = user;

    res.json({
      success: true,
      message: "Login successful",
      accessToken,
      refreshToken,
      user: safeUser,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
