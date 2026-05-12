import { Router, Request, Response } from "express";
import { verifyAccessToken } from "../../middleware/verifyAccessToken.js";
import { verifyRole } from "../../middleware/verifyRole.js";
import prisma from "../../utils/prisma.js";
import { broadcast } from "../../utils/ws.js";

const adminRouter = Router();

/**
 * @api {patch} /admin/requests/:id/approve Approve a Request
 * @apiName ApproveRequest
 * @apiGroup Admin
 */
adminRouter.patch(
  "/requests/:id/approve",
  verifyAccessToken,
  verifyRole(["admin"]),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const request = await prisma.request.findUnique({ where: { id } });

      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      if (request.status !== "pending_approval") {
        return res
          .status(400)
          .json({ error: "Request is not in pending_approval state" });
      }

      const updatedRequest = await prisma.request.update({
        where: { id },
        data: { status: "pending" },
      });

      broadcast("requests_changed");

      return res.status(200).json({
        message: "Request approved successfully",
        data: updatedRequest,
      });
    } catch (error) {
      console.error("Approve request error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * @api {patch} /admin/offers/:id/approve Approve an Offer
 * @apiName ApproveOffer
 * @apiGroup Admin
 */
adminRouter.patch(
  "/offers/:id/approve",
  verifyAccessToken,
  verifyRole(["admin"]),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const offer = await prisma.offer.findUnique({ where: { id } });

      if (!offer) {
        return res.status(404).json({ error: "Offer not found" });
      }

      if (offer.status !== "pending_approval") {
        return res
          .status(400)
          .json({ error: "Offer is not in pending_approval state" });
      }

      const updatedOffer = await prisma.offer.update({
        where: { id },
        data: { status: "active" },
      });

      broadcast("offers_changed");

      return res.status(200).json({
        message: "Offer approved successfully",
        data: updatedOffer,
      });
    } catch (error) {
      console.error("Approve offer error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default adminRouter;
