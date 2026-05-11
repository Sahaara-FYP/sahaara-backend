import { Router, type Request, type Response } from "express";
import prisma from "../../utils/prisma.js";
import bcrypt from "bcryptjs";
import {
  generateAccessToken,
  generateRefreshToken,
  generateVerificationToken,
} from "./auth.service.js";
import jwt from "jsonwebtoken";
import { createSignedUrls } from "../../utils/createSignedURL.js";
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
} from "../../utils/email.js";

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
    });

    if (newUser.profilePictureUrl) {
      const [signedUrl] = await createSignedUrls([newUser.profilePictureUrl]);
      if (signedUrl) {
        newUser.profilePictureUrl = signedUrl;
      }
    }

    const { passwordHash, ...safeUser } = newUser;

    // Generate Verification Token and Send Email
    const verificationToken = generateVerificationToken({ userId: newUser.id });
    // We don't await this to keep registration fast, or we could await if we want to ensure it's sent
    sendVerificationEmail(email, verificationToken).catch((err) =>
      console.error("Initial verification email failed:", err),
    );

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
        "fallbacktoverysecretkeyhehekeysecretveryovertofallback",
    ) as { userId: string; role: string };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId, isActive: true },
      select: { id: true, role: true, gender: true },
    });

    if (!user)
      return res.status(404).json({ message: "User not found or deactivated" });

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
  } catch (error: any) {
    console.error("Refresh token error:", error);
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }
});

/**
 * @api {get} /auth/verify-email Verify Email
 * @apiName VerifyEmail
 * @apiGroup Auth
 */
authRouter.get("/verify-email", async (req: Request, res: Response) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== "string") {
      return res
        .status(400)
        .send("<h1>Invalid Request</h1><p>Verification token is missing.</p>");
    }

    const decoded = jwt.verify(
      token,
      process.env.VERIFICATION_SECRET || "verification-secret-key-123",
    ) as { userId: string };

    await prisma.user.update({
      where: { id: decoded.userId },
      data: { isEmailVerified: true },
    });

    // Return a simple success page
    return res.send(`
      <div style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
        <h1 style="color: #3b82f6;">Email Verified!</h1>
        <p>Your email has been successfully verified. You can now return to the Sahaara app.</p>
        <p style="color: #666; font-size: 14px;">You can close this window now.</p>
      </div>
    `);
  } catch (error) {
    console.error("Email verification error:", error);
    return res
      .status(400)
      .send(
        "<h1>Verification Failed</h1><p>Link expired or invalid. Please request a new one from the app.</p>",
      );
  }
});

/**
 * @api {post} /auth/user/resend-verification-email Resend Verification Email
 * @apiName ResendVerificationEmail
 * @apiGroup Auth
 */
authRouter.post(
  "/user/resend-verification-email",
  async (req: Request, res: Response) => {
    try {
      // This assumes the user is logged in or provided their identity
      // Since verifyEmail.tsx calls this, it should have the token in headers if protected
      // But since it's /resend-verification-email we might need verifyAccessToken middleware
      // For now, let's just make it simple, if no user is provided, we can't send

      // In typical apps, we get user from token
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(
        token,
        process.env.JWT_ACCESS_SECRET || "fallbacktoverysecretkeyhehe",
      ) as { userId: string };

      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
      });
      if (!user) return res.status(404).json({ error: "User not found" });

      const verificationToken = generateVerificationToken({ userId: user.id });
      await sendVerificationEmail(user.email, verificationToken);

      return res.status(200).json({ message: "Verification email sent" });
    } catch (error) {
      console.error("Resend verification error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);
/**
 * @api {get} /auth/user/me Get Current User (Polling endpoint for verification)
 * @apiName GetUserMe
 * @apiGroup Auth
 */
authRouter.get("/user/me", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(
      token,
      process.env.JWT_ACCESS_SECRET || "fallbacktoverysecretkeyhehe",
    ) as { userId: string };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user) return res.status(404).json({ error: "User not found" });

    const { passwordHash, ...safeUser } = user;

    return res.status(200).json({
      user: safeUser,
      // For compatibility with some mobile logic that might expect Supabase-like structure
      auth: {
        email_confirmed_at: user.isEmailVerified ? new Date() : null,
      },
    });
  } catch (error) {
    console.error("Get /user/me error:", error);
    return res.status(401).json({ error: "Invalid token" });
  }
});

/**
 * @api {post} /auth/logout Logout
 * @apiName Logout
 * @apiGroup Auth
 */
authRouter.post("/logout", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.decode(token) as { userId: string };

      if (decoded && decoded.userId) {
        await prisma.user.update({
          where: { id: decoded.userId },
          data: { pushToken: null },
        });
      }
    }
    return res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    console.error("Logout error:", error);
    // Still return 200 as the client should proceed with local logout anyway
    return res.status(200).json({ message: "Logged out" });
  }
});

/**
 * @api {post} /auth/forgot-password Request Password Reset
 * @apiBody {String} email User's email
 */
authRouter.post("/forgot-password", async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // For security, we might want to return 200 even if user not found
      // but the user asked to "check if it exists" and then send code.
      // So I'll return 404 to be helpful for now as per instructions.
      return res.status(404).json({ error: "User with this email not found" });
    }

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const tokenHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    // Clear previous tokens and create new one
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    await sendPasswordResetEmail(email, code);

    return res.status(200).json({ message: "Reset code sent to your email" });
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * @api {post} /auth/verify-reset-code Verify Reset Code
 * @apiBody {String} email User's email
 * @apiBody {String} code 6-digit code
 */
authRouter.post("/verify-reset-code", async (req: Request, res: Response) => {
  try {
    const { email, code } = req.body;
    if (!email || !code)
      return res.status(400).json({ error: "Email and code are required" });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const resetToken = await prisma.passwordResetToken.findFirst({
      where: { userId: user.id },
      orderBy: { id: "desc" }, // Get the latest just in case, though we delete old ones
    });

    if (!resetToken)
      return res.status(400).json({ error: "No reset request found" });

    if (new Date() > resetToken.expiresAt) {
      await prisma.passwordResetToken.delete({ where: { id: resetToken.id } });
      return res.status(400).json({ error: "Code expired" });
    }

    const isMatch = await bcrypt.compare(code, resetToken.tokenHash);
    if (!isMatch) return res.status(400).json({ error: "Invalid code" });

    // Generate a temporary verification token to allow password reset
    const resetSessionToken = jwt.sign(
      { userId: user.id, purpose: "password_reset" },
      process.env.JWT_ACCESS_SECRET || "fallbacktoverysecretkeyhehe",
      { expiresIn: "10m" },
    );

    return res.status(200).json({
      message: "Code verified",
      resetSessionToken,
    });
  } catch (error) {
    console.error("Verify reset code error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * @api {post} /auth/reset-password Reset Password
 * @apiBody {String} resetSessionToken Token from verify-reset-code
 * @apiBody {String} newPassword New password
 */
authRouter.post("/reset-password", async (req: Request, res: Response) => {
  try {
    const { resetSessionToken, newPassword } = req.body;
    if (!resetSessionToken || !newPassword) {
      return res
        .status(400)
        .json({ error: "Token and new password are required" });
    }

    const decoded = jwt.verify(
      resetSessionToken,
      process.env.JWT_ACCESS_SECRET || "fallbacktoverysecretkeyhehe",
    ) as { userId: string; purpose: string };

    if (decoded.purpose !== "password_reset") {
      return res.status(400).json({ error: "Invalid token purpose" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: decoded.userId },
      data: { passwordHash: hashedPassword },
    });

    // Cleanup reset token
    await prisma.passwordResetToken.deleteMany({
      where: { userId: decoded.userId },
    });

    return res.status(200).json({ message: "Password reset successful" });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(400).json({ error: "Invalid or expired reset session" });
  }
});
