import { type Request, type Response, Router } from "express";
import { verifyAccessToken } from "../../middleware/verifyAccessToken.js";
import { verifyRole } from "../../middleware/verifyRole.js";
import upload from "../../middleware/multer.js";
import prisma from "./../../utils/prisma.js";
import supabase from "./../../utils/supabase.js";
import bcrypt from "bcryptjs";

export const usersRouter = Router();

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
        const safeName = req.file.originalname.replace(/\s+/g, "_");
        const filePath = `users/${userId}/${Date.now()}_${safeName}`;

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("attachments")
          .upload(filePath, req.file.buffer, {
            cacheControl: "3600",
            upsert: false,
          });

        if (uploadError) {
          console.error("Supabase upload error:", uploadError);
        } else {
          newProfileUrl = uploadData.path;

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
        return res
          .status(400)
          .json({ error: "Email, phone, or username already taken" });
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
