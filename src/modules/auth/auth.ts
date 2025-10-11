import { Router, type Request, type Response } from "express";
import prisma from "../../utils/prisma.js";
import bcrypt from "bcryptjs";
import { generateAccessToken, generateRefreshToken } from "./auth.service.js";
import jwt from "jsonwebtoken";

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
      include: {
        verifications: {
          select: {
            status: true,
          },
        },
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

authRouter.post("/refresh-token", async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: "Refresh token is required" });
    }

    const decoded = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET ||
        "fallbacktoverysecretkeyhehekeysecretveryovertofallback"
    ) as { userId: string; role: string };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId, isActive: true },
      select: { id: true, role: true },
    });

    if (!user)
      return res.status(404).json({ message: "User not found or deactivated" });

    const newAccessToken = generateAccessToken({
      userId: user.id,
      role: user.role,
    });
    const newRefreshToken = generateRefreshToken({
      userId: user.id,
      role: user.role,
    });

    return res.status(200).json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error: any) {
    console.error("Refresh token error:", error);
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }
});
