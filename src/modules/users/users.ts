import { type Request, type Response, Router } from "express";
import { verifyAccessToken } from "../../middleware/verifyAccessToken.js";
import { verifyRole } from "../../middleware/verifyRole.js";
import upload from "../../middleware/multer.js";
import prisma from "./../../utils/prisma.js";
import supabase from "./../../utils/supabase.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { createProfileSchema } from "./users.validation.js";
import { uploadFileToSupabase } from "../../utils/uploadFileToSupabase.js";

export const usersRouter = Router();

/**
 * @api {post} /users/profile Create User Profile When Onboarding
 * @apiName CreateUserProfile
 * @apiGroup Users
 *
 * @apiHeader {String} Authorization Bearer access token.
 *
 * @apiBody {String} fullName              Full name of the user.
 * @apiBody {String} username              Unique username for the user.
 * @apiBody {String="male","female"} gender Gender of the user.
 * @apiBody {String} dateOfBirth           Date of birth in ISO format (YYYY-MM-DD).
 * @apiBody {String} [bio]                   Short biography of the user.
 * @apiBody {String} cnicNumber            CNIC number of the user.
 * @apiBody {String} phoneNumber            Phone number of the user.
 * @apiBody {Object[]} [skills]              JSON array of user skills.
 */
usersRouter.post(
  "/profile",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;

      const data = createProfileSchema.parse(req.body);

      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [{ username: data.username }, { phoneNumber: data.phoneNumber }],
          NOT: { id: userId },
        },
      });

      if (existingUser) {
        if (existingUser.username === data.username) {
          return res.status(400).json({ error: "Username is already taken" });
        }
        if (existingUser.phoneNumber === data.phoneNumber) {
          return res
            .status(400)
            .json({ error: "Phone number is already taken" });
        }
      }

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          ...data,
          completedOnboarding: true,
        },
      });

      return res.status(200).json({
        message: "Profile created successfully",
        user: updatedUser,
      });
    } catch (error: any) {
      console.error("Update profile error:", error);

      if (error.name === "ZodError") {
        return res.status(400).json({ error: error.errors });
      }

      if (error.code === "P2002") {
        return res
          .status(400)
          .json({ error: "Username or phone number already taken" });
      }

      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * @api {patch} /users/profile Update User Profile
 * @apiName UpdateUserProfile
 * @apiGroup Users
 *
 * @apiHeader {String} Authorization Bearer access token.
 *
 * @apiBody {String} [fullName]              Full name of the user.
 * @apiBody {String} [username]              Unique username for the user.
 * @apiBody {String="male","female","other"} [gender] Gender of the user.
 * @apiBody {String} [dateOfBirth]           Date of birth in ISO format (YYYY-MM-DD).
 * @apiBody {String} [bio]                   Short biography of the user.
 * @apiBody {String} [cnicNumber]            CNIC number of the user.
 * @apiBody {Object[]} [skills]              JSON array of user skills.
 * @apiBody {File} [profilePicture]          Optional profile picture file (multipart/form-data).
 */
usersRouter.patch(
  "/profile",
  verifyAccessToken,
  upload.single("profilePicture"),
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;

      const {
        fullName,
        username,
        gender,
        dateOfBirth,
        bio,
        cnicNumber,
        skills,
      } = req.body || {};

      const currentUserDetails = await prisma.user.findUnique({
        where: { id: userId },
      });

      const oldProfileUrl = currentUserDetails?.profilePictureUrl ?? null;

      let newProfileUrl = oldProfileUrl;
      if (req.file) {
        const { data, error } = await uploadFileToSupabase(
          "users",
          userId,
          req.file
        );

        if (error) {
          console.error("Supabase upload error:", error);
        } else {
          newProfileUrl = data?.path || "";

          if (oldProfileUrl) {
            const { error: deleteError } = await supabase.storage
              .from("attachments")
              .remove([oldProfileUrl]);

            if (deleteError) {
              console.error("Supabase delete error:", deleteError);
            }
          }
        }

        const updatedUser = await prisma.user.update({
          where: { id: userId },
          data: {
            fullName,
            username,
            gender,
            dateOfBirth: dateOfBirth
              ? new Date(dateOfBirth)
              : currentUserDetails?.dateOfBirth
              ? currentUserDetails.dateOfBirth
              : null,
            bio,
            cnicNumber,
            skills: skills ? JSON.parse(skills) : undefined,
            profilePictureUrl: newProfileUrl,
          },
        });

        return res.status(200).json({
          message: "Profile updated successfully",
          user: updatedUser,
        });
      }
    } catch (error: any) {
      console.error("Update profile error:", error);

      if (error.code === "P2002") {
        return res.status(400).json({ error: "Username already taken" });
      }

      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * @api {post} /users/change-password Change User Password
 * @apiName ChangeUserPassword
 * @apiGroup Users
 *
 * @apiHeader {String} Authorization Bearer access token.
 *
 * @apiBody {String} currentPassword Current password of the user (required).
 * @apiBody {String} newPassword     New password to be set (required).
 *
 */
usersRouter.post(
  "/change-password",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const { currentPassword, newPassword } = req.body || {};

      if (!currentPassword || !newPassword) {
        return res
          .status(400)
          .json({ error: "Both current and new passwords are required" });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { passwordHash: true },
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isMatch) {
        return res.status(400).json({ error: "Current password is incorrect" });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);

      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash: hashedPassword },
      });

      return res.status(200).json({ message: "Password changed successfully" });
    } catch (error) {
      console.error("Change password error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * @api {post} /users/reset-password-request Request Password Reset
 * @apiName RequestPasswordReset
 * @apiGroup Users
 *
 * @apiBody {String} identifier Email, username, or phone number of the user.
 *
 * @apiSuccess {String} message Generic success message (always returned).
 */
usersRouter.post("/reset-password-request", async (req, res) => {
  try {
    const { identifier } = req.body || {};
    if (!identifier) {
      return res.status(400).json({ error: "Identifier is required" });
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
      return res.status(200).json({
        message: "If an account exists, reset instructions have been sent.",
      });
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = await bcrypt.hash(rawToken, 10);

    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashedToken,
        expiresAt: new Date(Date.now() + 1000 * 60 * 15),
      },
    });

    // TODO: Send via email or SMS

    return res.status(200).json({
      message: "If an account exists, reset instructions have been sent.",
    });
  } catch (error) {
    console.error("Reset password request error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * @api {post} /users/reset-password Reset Password
 * @apiName ResetPassword
 * @apiGroup Users
 *
 * @apiBody {String} userId        ID of the user (from reset link).
 * @apiBody {String} token         Raw reset token from link.
 * @apiBody {String} newPassword   New password to set.
 *
 * @apiSuccess {String} message Success message.
 */
usersRouter.post("/reset-password", async (req, res) => {
  try {
    const { userId, token, newPassword } = req.body || {};

    if (!userId || !token || !newPassword) {
      return res
        .status(400)
        .json({ error: "userId, token, and newPassword are required" });
    }

    const resetToken = await prisma.passwordResetToken.findFirst({
      where: { userId },
    });

    if (
      !resetToken ||
      resetToken.expiresAt < new Date() ||
      !(await bcrypt.compare(token, resetToken.tokenHash))
    ) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hashedPassword },
    });

    await prisma.passwordResetToken.deleteMany({
      where: { userId },
    });

    return res
      .status(200)
      .json({ message: "Password has been reset successfully" });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

usersRouter.post(
  "/kyc-verification",
  verifyAccessToken,
  upload.fields([
    { name: "cnicFront", maxCount: 1 },
    { name: "cnicBack", maxCount: 1 },
    { name: "selfieWithCnic", maxCount: 1 },
  ]),
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const files = req.files as {
        [fieldname: string]: Express.Multer.File[];
      };

      if (
        !files?.cnicFront?.[0] ||
        !files?.cnicBack?.[0] ||
        !files?.selfieWithCnic?.[0]
      ) {
        return res.status(400).json({
          error: "CNIC front, CNIC back, and selfie with CNIC are all required",
        });
      }

      const existing = await prisma.verification.findFirst({
        where: { userId, status: "pending" },
      });
      if (existing) {
        return res.status(400).json({
          error:
            "You already have a pending verification request. Please wait for admin review.",
        });
      }

      const { data: cnicFrontData } = await uploadFileToSupabase(
        "kyc_verification",
        userId,
        files.cnicFront[0]
      );

      const { data: cnicBackData } = await uploadFileToSupabase(
        "kyc_verification",
        userId,
        files.cnicBack[0]
      );

      const { data: selfieWithCnicData } = await uploadFileToSupabase(
        "kyc_verification",
        userId,
        files.selfieWithCnic[0]
      );
      const cnicFrontUrl = cnicFrontData?.path || "";
      const cnicBackUrl = cnicBackData?.path || "";
      const selfieWithCnicUrl = selfieWithCnicData?.path || "";

      const verification = await prisma.verification.create({
        data: {
          userId,
          cnicFrontUrl,
          cnicBackUrl,
          selfieWithCnicUrl,
          status: "pending",
        },
      });

      return res.status(201).json({
        message: "KYC submitted successfully. Awaiting admin review.",
        verification,
      });
    } catch (error) {
      console.error("KYC verification error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);
