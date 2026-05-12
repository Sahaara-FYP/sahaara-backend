import cron from "node-cron";
import prisma from "../utils/prisma.js";
import { broadcast } from "../utils/ws.js";

/**
 * Service to handle automatic expiry of Requests, Offers, and Alerts.
 * Runs every hour to check for posts that have passed their expiresAt date.
 */
export const initExpiryService = () => {
  // Run every hour
  cron.schedule("*/5 * * * *", async () => {
    try {
      console.log("Checking for expired content (Requests, Offers, Alerts)...");

      const now = new Date();

      // 1. Expire Requests
      const expiredRequests = await prisma.request.updateMany({
        where: {
          status: { in: ["pending", "partially_accepted"] },
          expiresAt: { lt: now },
        },
        data: {
          status: "expired",
        },
      });

      // 2. Expire Offers
      const expiredOffers = await prisma.offer.updateMany({
        where: {
          status: { in: ["active"] }, // We don't expire paused/depleted ones usually, but active ones for sure
          expiresAt: { lt: now },
        },
        data: {
          status: "expired",
        },
      });

      // 3. Expire Alerts
      const expiredAlerts = await prisma.alert.updateMany({
        where: {
          status: { in: ["active"] },
          expiresAt: { lt: now },
        },
        data: {
          status: "expired",
        },
      });

      const totalExpired =
        expiredRequests.count + expiredOffers.count + expiredAlerts.count;

      if (totalExpired > 0) {
        console.log(
          `Successfully expired content: ${expiredRequests.count} requests, ${expiredOffers.count} offers, ${expiredAlerts.count} alerts.`,
        );

        // Notify clients to refresh feeds
        broadcast("content_expired");
        if (expiredRequests.count > 0) broadcast("requests_changed");
        if (expiredOffers.count > 0) broadcast("offers_changed");
        if (expiredAlerts.count > 0) broadcast("alerts_changed");
      }
    } catch (error) {
      console.error("Error in unified expiry service:", error);
    }
  });

  console.log("Unified Expiry service initialized (running hourly).");
};
