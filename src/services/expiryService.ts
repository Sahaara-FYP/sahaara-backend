import cron from "node-cron";
import prisma from "../utils/prisma.js";
import { broadcast } from "../utils/ws.js";

/**
 * Service to handle automatic expiry of requests.
 * Runs every hour to check for requests that have passed their expiresAt date.
 */
export const initExpiryService = () => {
  // Run every hour
  cron.schedule("0 * * * *", async () => {
    try {
      console.log("Checking for expired requests...");

      const now = new Date();

      const expiredRequests = await prisma.request.updateMany({
        where: {
          status: { in: ["pending", "partially_accepted"] },
          expiresAt: { lt: now },
        },
        data: {
          status: "expired",
        },
      });

      if (expiredRequests.count > 0) {
        console.log(`Successfully expired ${expiredRequests.count} requests.`);
        broadcast("requests_changed");
      }
    } catch (error) {
      console.error("Error in expiry service:", error);
    }
  });

  console.log("Expiry service initialized (running hourly).");
};
