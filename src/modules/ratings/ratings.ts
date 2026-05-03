import { type Request, type Response, Router } from "express";
import { verifyAccessToken } from "../../middleware/verifyAccessToken.js";
import prisma from "../../utils/prisma.js";

export const ratingsRouter = Router();

/**
 * @api {post} /ratings Submit a Rating
 * @apiName SubmitRating
 * @apiGroup Ratings
 * @apiPermission authenticated
 *
 * @apiHeader {String} Authorization Bearer token.
 *
 * @apiBody {String} toId The ID of the user being rated.
 * @apiBody {Number} score The rating score (1-5).
 * @apiBody {String} [comment] Optional review comment.
 * @apiBody {String} [requestId] Context: Request ID.
 * @apiBody {String} [offerId] Context: Offer ID.
 */
ratingsRouter.post(
  "/",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const fromId = req.userId!;
      const { toId, score, comment, requestId, offerId } = req.body;

      if (!toId || !score || score < 1 || score > 5) {
        return res.status(400).json({
          error: "Invalid rating data. 'toId' and 'score' (1-5) are required.",
        });
      }

      if (!requestId && !offerId) {
        return res.status(400).json({
          error:
            "Context is required: Must provide either 'requestId' or 'offerId'.",
        });
      }

      if (fromId === toId) {
        return res.status(400).json({ error: "You cannot rate yourself." });
      }

      // Check if rating already exists for this context
      const existingRating = await prisma.rating.findFirst({
        where: {
          fromId,
          toId,
          ...(requestId ? { requestId } : {}),
          ...(offerId ? { offerId } : {}),
        },
      });

      if (existingRating) {
        return res.status(400).json({
          error: "You have already rated this user for this interaction.",
        });
      }

      // Use a transaction to create rating and update user stats
      const newRating = await prisma.$transaction(async (tx) => {
        const rating = await tx.rating.create({
          data: {
            fromId,
            toId,
            score: parseInt(score),
            comment,
            requestId,
            offerId,
          },
        });

        // Recalculate average rating
        const stats = await tx.rating.aggregate({
          where: { toId },
          _avg: { score: true },
          _count: { _all: true },
        });

        await tx.user.update({
          where: { id: toId },
          data: {
            averageRating: stats._avg?.score || 0,
            totalRatings: stats._count?._all || 0,
          },
        });

        return rating;
      });

      return res
        .status(201)
        .json({ message: "Rating submitted successfully", rating: newRating });
    } catch (error) {
      console.error("Submit rating error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * @api {get} /ratings/user/:id Get Ratings for User
 * @apiName GetUserRatings
 * @apiGroup Ratings
 * @apiPermission authenticated
 *
 * @apiHeader {String} Authorization Bearer token.
 */
ratingsRouter.get(
  "/user/:id",
  verifyAccessToken,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const ratings = await prisma.rating.findMany({
        where: { toId: id as string },
        include: {
          from: {
            select: {
              id: true,
              fullName: true,
              username: true,
              profilePictureUrl: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      return res
        .status(200)
        .json({ message: "Ratings fetched successfully", data: ratings });
    } catch (error) {
      console.error("Get ratings error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);
