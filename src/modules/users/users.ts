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
import { createSignedUrls } from "../../utils/createSignedURL.js";

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
 * @apiBody {String} address                   Current Home address of the user.
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
          OR: [
            { username: data.username },
            { phoneNumber: data.phoneNumber },
            { cnicNumber: data.cnicNumber },
          ],
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
        user: { ...updatedUser, hasPendingVerification: false },
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
  },
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
        phoneNumber,
        address,
        skills,
      } = req.body || {};

      const currentUserDetails = await prisma.user.findUnique({
        where: { id: userId },
      });

      const oldProfileUrl = currentUserDetails?.profilePictureUrl ?? null;
      let newProfileUrl = oldProfileUrl;

      // Handle profile picture upload (optional)
      if (req.file) {
        const { data, error } = await uploadFileToSupabase(
          "users",
          userId,
          req.file,
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
      }

      // Always run the DB update regardless of whether a file was uploaded
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          ...(fullName !== undefined && { fullName }),
          ...(username !== undefined && { username }),
          ...(gender !== undefined && { gender }),
          ...(bio !== undefined && { bio }),
          ...(cnicNumber !== undefined && { cnicNumber }),
          ...(phoneNumber !== undefined && { phoneNumber }),
          ...(address !== undefined && { address }),
          ...(skills !== undefined && { skills: JSON.parse(skills) }),
          dateOfBirth: dateOfBirth
            ? new Date(dateOfBirth)
            : (currentUserDetails?.dateOfBirth ?? null),
          profilePictureUrl: newProfileUrl,
        },
      });

      const pendingVerification = await prisma.verification.findFirst({
        where: { userId, status: "pending" },
      });

      if (updatedUser.profilePictureUrl) {
        const [signedUrl] = await createSignedUrls([
          updatedUser.profilePictureUrl,
        ]);
        if (signedUrl) {
          updatedUser.profilePictureUrl = signedUrl;
        }
      }

      const { passwordHash, ...safeUser } = updatedUser as any;

      return res.status(200).json({
        message: "Profile updated successfully",
        user: {
          ...safeUser,
          hasPendingVerification: !!pendingVerification,
        },
      });
    } catch (error: any) {
      console.error("Update profile error:", error);

      if (error.code === "P2002") {
        return res.status(400).json({ error: "Username already taken" });
      }

      return res.status(500).json({ error: "Internal server error" });
    }
  },
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
  },
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
        files.cnicFront[0],
      );

      const { data: cnicBackData } = await uploadFileToSupabase(
        "kyc_verification",
        userId,
        files.cnicBack[0],
      );

      const { data: selfieWithCnicData } = await uploadFileToSupabase(
        "kyc_verification",
        userId,
        files.selfieWithCnic[0],
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
  },
);

/**
 * @api {get} /users/me/stats Get User Statistics
 * @apiName GetUserStats
 * @apiGroup Users
 *
 * @apiHeader {String} Authorization Bearer access token.
 *
 * @apiSuccess {Number} totalRequests Total requests posted by the user.
 * @apiSuccess {Number} totalOffers Total offers posted by the user.
 * @apiSuccess {Number} totalParticipations Total requests the user participated in (helped with).
 * @apiSuccess {Number} totalAlerts Total alerts posted by the user.
 */
usersRouter.get(
  "/me/stats",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;

      const [
        totalRequests,
        totalOffers,
        totalParticipations,
        totalAlerts,
        user,
      ] = await Promise.all([
        prisma.request.count({ where: { userId } }),
        prisma.offer.count({ where: { userId } }),
        prisma.requestParticipator.count({ where: { userId } }),
        prisma.alert.count({ where: { userId } }),
        prisma.user.findUnique({
          where: { id: userId },
          select: { averageRating: true, totalRatings: true },
        }),
      ]);

      return res.status(200).json({
        message: "User stats fetched successfully.",
        stats: {
          totalRequests,
          totalOffers,
          totalParticipations,
          totalAlerts,
          averageRating: user?.averageRating || 0,
          totalRatings: user?.totalRatings || 0,
        },
      });
    } catch (error) {
      console.error("Error fetching user stats:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

usersRouter.get(
  "/me",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;

      if (!userId) {
        return res.status(401).json({
          message: "Unauthorized. Missing user ID in token.",
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        return res.status(404).json({
          message: "User not found.",
        });
      }

      const pendingVerification = await prisma.verification.findFirst({
        where: { userId, status: "pending" },
      });

      if (user.profilePictureUrl) {
        const [signedUrl] = await createSignedUrls([user.profilePictureUrl]);
        if (signedUrl) {
          user.profilePictureUrl = signedUrl;
        }
      }

      const { passwordHash, ...safeUser } = user;

      return res.status(200).json({
        message: "User data fetched successfully.",
        user: {
          ...safeUser,
          hasPendingVerification: !!pendingVerification,
        },
      });
    } catch (error) {
      console.error("Error fetching user data:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error.",
      });
    }
  },
);

/**
 * @api {patch} /users/location Sync User Location
 * @apiName SyncUserLocation
 * @apiGroup Users
 *
 * @apiHeader {String} Authorization Bearer access token.
 *
 * @apiBody {Number} lat Latitude coordinate.
 * @apiBody {Number} lng Longitude coordinate.
 *
 * @apiSuccess {String} message Success message.
 */
usersRouter.patch(
  "/location",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const { lat, lng } = req.body;

      if (typeof lat !== "number" || typeof lng !== "number") {
        return res
          .status(400)
          .json({ error: "Latitude and longitude must be valid numbers." });
      }

      await prisma.user.update({
        where: { id: userId },
        data: {
          lastLocationLat: lat,
          lastLocationLng: lng,
          locationUpdatedAt: new Date(),
        },
      });

      return res.status(200).json({ message: "Location updated successfully" });
    } catch (error) {
      console.error("Error updating location:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ============================
// ADMIN: KYC VERIFICATION MANAGEMENT
// ============================

/**
 * @api {get} /users/admin/verifications List KYC Verifications (Admin)
 * @apiName AdminListVerifications
 * @apiGroup Users
 * @apiPermission admin
 *
 * @apiQuery {String} [status] Filter by verification status (pending, verified, rejected).
 * @apiQuery {Number} [limit=20] Number of results per page.
 * @apiQuery {Number} [offset=0] Offset for pagination.
 */
usersRouter.get(
  "/admin/verifications",
  verifyAccessToken,
  verifyRole(["admin"]),
  async (req: Request, res: Response) => {
    try {
      const { status, limit = "20", offset = "0" } = req.query;

      const limitNum = Math.max(1, Math.min(100, parseInt(limit as string, 10) || 20));
      const offsetNum = Math.max(0, parseInt(offset as string, 10) || 0);

      const where: any = {};
      if (status) where.status = status as string;

      const [verifications, totalCount] = await Promise.all([
        prisma.verification.findMany({
          where,
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                username: true,
                email: true,
                phoneNumber: true,
                cnicNumber: true,
                gender: true,
                dateOfBirth: true,
                profilePictureUrl: true,
                isVerified: true,
                isActive: true,
                createdAt: true,
              },
            },
          },
          take: limitNum,
          skip: offsetNum,
          orderBy: { createdAt: "desc" },
        }),
        prisma.verification.count({ where }),
      ]);

      // Resolve signed URLs for KYC images and profile pictures
      for (const v of verifications) {
        const pathsToSign: string[] = [];
        if (v.cnicFrontUrl) pathsToSign.push(v.cnicFrontUrl);
        if (v.cnicBackUrl) pathsToSign.push(v.cnicBackUrl);
        if (v.selfieWithCnicUrl) pathsToSign.push(v.selfieWithCnicUrl);
        if (v.user.profilePictureUrl) pathsToSign.push(v.user.profilePictureUrl);

        const signedUrls = await createSignedUrls(pathsToSign);
        let idx = 0;
        if (v.cnicFrontUrl) { (v as any).cnicFrontUrl = signedUrls[idx++]; }
        if (v.cnicBackUrl) { (v as any).cnicBackUrl = signedUrls[idx++]; }
        if (v.selfieWithCnicUrl) { (v as any).selfieWithCnicUrl = signedUrls[idx++]; }
        if (v.user.profilePictureUrl) { (v.user as any).profilePictureUrl = signedUrls[idx++]; }
      }

      const totalPages = Math.ceil(totalCount / limitNum);
      const page = Math.floor(offsetNum / limitNum) + 1;

      return res.status(200).json({
        data: verifications,
        pagination: {
          total: totalCount,
          page,
          limit: limitNum,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        message: "Verifications fetched successfully",
      });
    } catch (error) {
      console.error("Admin list verifications error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * @api {patch} /users/admin/verifications/:id/status Update KYC Verification Status (Admin)
 * @apiName AdminUpdateVerificationStatus
 * @apiGroup Users
 * @apiPermission admin
 *
 * @apiParam {String} id Verification ID.
 * @apiBody {String="verified","rejected"} status New status.
 * @apiBody {String} [adminNotes] Optional notes from admin.
 */
usersRouter.patch(
  "/admin/verifications/:id/status",
  verifyAccessToken,
  verifyRole(["admin"]),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status, adminNotes } = req.body;

      if (!id) {
        return res.status(400).json({ error: "Verification ID is required" });
      }

      if (!status || !["verified", "rejected"].includes(status)) {
        return res
          .status(400)
          .json({ error: "Valid status (verified or rejected) is required" });
      }

      const verification = await prisma.verification.findUnique({
        where: { id },
      });
      if (!verification) {
        return res.status(404).json({ error: "Verification not found" });
      }

      const result = await prisma.$transaction(async (tx) => {
        const updatedVerification = await tx.verification.update({
          where: { id },
          data: {
            status,
            adminNotes: adminNotes || null,
            verifiedAt: status === "verified" ? new Date() : null,
          },
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                username: true,
                email: true,
                isVerified: true,
              },
            },
          },
        });

        // Update user's isVerified status on the User model
        await tx.user.update({
          where: { id: verification.userId },
          data: { isVerified: status === "verified" },
        });

        return updatedVerification;
      });

      return res.status(200).json({
        message: `Verification ${status} successfully`,
        verification: result,
      });
    } catch (error) {
      console.error("Admin update verification error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * @api {get} /users/admin/users Admin List Users
 * @apiName AdminListUsers
 * @apiGroup Users
 * @apiPermission admin
 *
 * @apiQuery {Number} [limit=10] Items per page.
 * @apiQuery {Number} [offset=0] Pagination offset.
 * @apiQuery {String} [search] Search term (matches full_name, email, username, phone_number).
 * @apiQuery {String} [role] Filter by role.
 * @apiQuery {String} [isActive] Filter by active status (true/false).
 * @apiQuery {String} [isVerified] Filter by verification status (true/false).
 */
usersRouter.get(
  "/admin/users",
  verifyAccessToken,
  verifyRole(["admin"]),
  async (req: Request, res: Response) => {
    try {
      const {
        limit = "10",
        offset = "0",
        search,
        role,
        isActive,
        isVerified,
      } = req.query;

      const itemsLimit = Math.max(1, parseInt(limit as string, 10) || 10);
      const itemsOffset = Math.max(0, parseInt(offset as string, 10) || 0);

      const where: any = {};

      if (search) {
        where.OR = [
          { fullName: { contains: search as string, mode: "insensitive" } },
          { email: { contains: search as string, mode: "insensitive" } },
          { username: { contains: search as string, mode: "insensitive" } },
          { phoneNumber: { contains: search as string, mode: "insensitive" } },
        ];
      }

      if (role) {
        where.role = role as string;
      }

      if (isActive !== undefined) {
        where.isActive = isActive === "true";
      }

      if (isVerified !== undefined) {
        where.isVerified = isVerified === "true";
      }

      const users = await prisma.user.findMany({
        where,
        take: itemsLimit,
        skip: itemsOffset,
        orderBy: { createdAt: "desc" },
        include: {
          _count: {
            select: {
              requests: true,
              offers: true,
              reportsMade: true,
              reportsReceived: true,
            },
          },
        },
      });

      const totalItems = await prisma.user.count({ where });

      for (const user of users) {
        if (user.profilePictureUrl) {
          const [signedUrl] = await createSignedUrls([user.profilePictureUrl]);
          if (signedUrl) {
            user.profilePictureUrl = signedUrl;
          }
        }
      }

      return res.status(200).json({
        data: users,
        pagination: {
          totalItems,
          totalPages: Math.ceil(totalItems / itemsLimit),
          currentPage: Math.floor(itemsOffset / itemsLimit) + 1,
          itemsPerPage: itemsLimit,
        },
      });
    } catch (error) {
      console.error("Admin list users error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * @api {patch} /users/admin/users/:id Admin Update User
 * @apiName AdminUpdateUser
 * @apiGroup Users
 * @apiPermission admin
 *
 * @apiParam {String} id User ID.
 * @apiBody {Boolean} [isActive] Update active status.
 * @apiBody {Boolean} [isVerified] Update verification status.
 * @apiBody {String="admin","user"} [role] Update user role.
 */
usersRouter.patch(
  "/admin/users/:id",
  verifyAccessToken,
  verifyRole(["admin"]),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { isActive, isVerified, role } = req.body;

      if (!id) {
        return res.status(400).json({ error: "User ID is required" });
      }

      const user = await prisma.user.findUnique({
        where: { id },
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const updateData: any = {};
      if (isActive !== undefined) updateData.isActive = Boolean(isActive);
      if (isVerified !== undefined) updateData.isVerified = Boolean(isVerified);
      if (role && ["admin", "user"].includes(role)) updateData.role = role;

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: "No valid fields provided to update" });
      }

      const updatedUser = await prisma.user.update({
        where: { id },
        data: updateData,
        include: {
          _count: {
            select: {
              requests: true,
              offers: true,
              reportsMade: true,
              reportsReceived: true,
            },
          },
        },
      });

      return res.status(200).json({
        message: "User updated successfully",
        user: updatedUser,
      });
    } catch (error) {
      console.error("Admin update user error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);
