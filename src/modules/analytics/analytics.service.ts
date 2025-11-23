import { scaleTime } from "../../utils/formatTime.js";
import prisma from "../../utils/prisma.js";
import { subMonths, startOfMonth, endOfMonth, format } from "date-fns";

export async function totalActiveRequests() {
  try {
    const count = await prisma.request.count({
      where: {
        status: { in: ["accepted", "pending", "partially_accepted"] },
      },
    });
    return count;
  } catch (error) {
    console.error("Error fetching total active requests:", error);
    throw error;
  }
}

export async function totalPendingVerifications() {
  try {
    const count = await prisma.verification.count({
      where: {
        status: "pending",
      },
    });
    return count;
  } catch (error) {
    console.error("Error fetching pending verifications:", error);
    throw error;
  }
}

export async function totalActiveAlerts() {
  try {
    const count = await prisma.alert.count({
      where: {
        status: "active",
      },
    });
    return count;
  } catch (error) {
    console.error("Error fetching total active alerts:", error);
    throw error;
  }
}

export async function totalUsers() {
  try {
    const count = await prisma.user.count({
      where: {
        role: "user",
      },
    });
    return count;
  } catch (error) {
    console.error("Error fetching total users:", error);
    throw error;
  }
}

export async function averageFirstResponseTime() {
  try {
    // Fetch all requests with their earliest participation
    const requests = await prisma.request.findMany({
      select: {
        createdAt: true,
        participators: {
          select: {
            createdAt: true,
          },
          orderBy: {
            createdAt: "asc",
          },
          take: 1, // only the first participation
        },
      },
    });

    const respondedRequests = requests.filter(
      (r) => r.participators.length > 0
    );

    if (respondedRequests.length === 0) return 0;

    // Calculate total first-response time in milliseconds
    const totalMs = respondedRequests.reduce((sum, r) => {
      const firstResponse = r.participators[0]!.createdAt;
      const diff = firstResponse.getTime() - r.createdAt.getTime();
      return sum + diff;
    }, 0);

    // Return average in milliseconds (convert to minutes if needed)
    const avgMs = totalMs / respondedRequests.length;
    return scaleTime(avgMs);
  } catch (error) {
    console.error("Error calculating average first-response time:", error);
    throw error;
  }
}

export async function totalCompletionRate() {
  try {
    const totalRequests = await prisma.request.count();
    const completedRequests = await prisma.request.count({
      where: { status: "completed" },
    });

    const totalAlerts = await prisma.alert.count();
    const resolvedAlerts = await prisma.alert.count({
      where: { status: "resolved" },
    });

    //OFFERS WILL BE ADDED LATER
    const totalItems = totalRequests + totalAlerts;
    const totalCompleted = completedRequests + resolvedAlerts;

    const completionRate =
      totalItems === 0 ? 0 : (totalCompleted / totalItems) * 100;

    return Math.floor(completionRate); // percentage
  } catch (error) {
    console.error("Error calculating total completion rate:", error);
    throw error;
  }
}

export async function totalTrendData() {
  try {
    const trendData = [];

    for (let i = 5; i >= 0; i--) {
      const current = subMonths(new Date(), i);
      const start = startOfMonth(current);
      const end = endOfMonth(current);
      const monthLabel = format(start, "MMM"); // Jan, Feb, etc.

      const requestsCount = await prisma.request.count({
        where: {
          createdAt: {
            gte: start,
            lte: end,
          },
        },
      });

      const alertsCount = await prisma.alert.count({
        where: {
          createdAt: {
            gte: start,
            lte: end,
          },
        },
      });

      // const offersCount = await prisma.offer.count({
      //   where: {
      //     createdAt: {
      //       gte: start,
      //       lte: end,
      //     },
      //   },
      // });

      trendData.push({
        month: monthLabel,
        requests: requestsCount,
        alerts: alertsCount,
        // offers: offersCount,
      });
    }

    return trendData;
  } catch (error) {
    console.error("Error generating trend data:", error);
    throw error;
  }
}
