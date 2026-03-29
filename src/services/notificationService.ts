import prisma from "../utils/prisma.js";

// Haversine formula to calculate distance between two lat/lng coordinates in km
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in km
  return d;
}

function deg2rad(deg: number) {
  return deg * (Math.PI / 180);
}

export async function sendPushNotification(
  expoPushToken: string,
  title: string,
  body: string,
  data?: any,
) {
  const message = {
    to: expoPushToken,
    sound: "default",
    title,
    body,
    data,
  };

  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });
  } catch (error) {
    console.error("Error sending push notification:", error);
  }
}

export async function broadcastNotification(
  title: string,
  body: string,
  type: string,
  metadata: any,
  lat: number,
  lng: number,
  radiusKm: number,
  limit?: number,
) {
  try {
    // 1. Fetch all users who have recently updated their location and have a push token
    // In a real large-scale app, we'd use PostGIS or native Postgres Earthdistance.
    // For this prototype, we'll fetch recently active users and calculate distance in JS if the user base is small.
    // However, considering Prisma limitations, we will fetch users with locations and filter.

    const users = await prisma.user.findMany({
      where: {
        lastLocationLat: { not: null },
        lastLocationLng: { not: null },
        pushToken: { not: null },
      },
      select: {
        id: true,
        pushToken: true,
        lastLocationLat: true,
        lastLocationLng: true,
      },
    });

    // 2. Filter users within radius
    const nearbyUsers = users
      .map((u) => {
        const dist = calculateDistance(
          lat,
          lng,
          u.lastLocationLat!,
          u.lastLocationLng!,
        );
        return { ...u, distance: dist };
      })
      .filter((u) => u.distance <= radiusKm)
      .sort((a, b) => a.distance - b.distance);

    // 3. Apply limit if necessary (e.g. Top 20 for Smart Matching)
    const targetUsers = limit ? nearbyUsers.slice(0, limit) : nearbyUsers;

    if (targetUsers.length === 0) return;

    // 4. Create Notification Records
    const notificationData = targetUsers.map((u) => ({
      userId: u.id,
      title,
      body,
      type: type as any,
      metadata: metadata || {},
    }));

    await prisma.notification.createMany({
      data: notificationData,
    });

    // 5. Send Push Notifications via Expo
    const pushPromises = targetUsers.map((u) => {
      if (u.pushToken) {
        return sendPushNotification(u.pushToken, title, body, metadata);
      }
    });

    await Promise.all(pushPromises.filter(Boolean));
    console.log(`Broadcasted to ${targetUsers.length} users.`);
  } catch (error) {
    console.error("Error broadcasting notification:", error);
  }
}

export async function smartMatchRequest(
  requestId: string,
  title: string,
  body: string,
  category: string,
  lat: number,
  lng: number,
  radiusKm: number = 10,
  limit: number = 20,
) {
  try {
    const requester = await prisma.request.findUnique({
      where: { id: requestId },
      select: { userId: true },
    });

    // 1. Fetch nearby users with relevant data for scoring
    const users = await prisma.user.findMany({
      where: {
        lastLocationLat: { not: null },
        lastLocationLng: { not: null },
        pushToken: { not: null },
        ...(requester?.userId ? { id: { not: requester.userId } } : {}),
      },
      select: {
        id: true,
        pushToken: true,
        lastLocationLat: true,
        lastLocationLng: true,
        skills: true,
        averageRating: true,
        isVerified: true,
        _count: {
          select: {
            requestParticipations: {
              where: {
                request: { category: category as any },
                status: "accepted",
              },
            },
          },
        },
      },
    });

    // 2. Score users based on the priority algorithm
    const scoredUsers = users
      .map((u) => {
        const distance = calculateDistance(
          lat,
          lng,
          u.lastLocationLat!,
          u.lastLocationLng!,
        );

        if (distance > radiusKm) return null;

        let score = 0;

        // Proximity Score (20%): Closer is better
        const proximityScore = Math.max(0, (1 - distance / radiusKm) * 20);
        score += proximityScore;

        // Skill Match (40%): Check if user listed this category as a skill
        let hasSkill = false;
        if (u.skills && Array.isArray(u.skills)) {
          hasSkill = u.skills.some(
            (s: any) => s.toString().toLowerCase() === category.toLowerCase(),
          );
        }
        if (hasSkill) score += 40;

        // History Match (30%): Based on past successful participations in this category
        const historyCount = u._count.requestParticipations;
        const historyScore = Math.min(30, historyCount * 10); // Capped at 30
        score += historyScore;

        // Trust Score (10%): Based on rating and verification status
        let trustScore = (u.averageRating || 0) * 1.5; // Max 7.5
        if (u.isVerified) trustScore += 2.5; // Max 2.5
        score += trustScore;

        return { ...u, score, distance };
      })
      .filter((u): u is NonNullable<typeof u> => u !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (scoredUsers.length === 0) return;

    // 3. Create Notification Records in DB
    const notificationData = scoredUsers.map((u) => ({
      userId: u.id,
      title,
      body,
      type: "help_request_nearby" as any,
      metadata: { requestId },
    }));

    await prisma.notification.createMany({
      data: notificationData,
    });

    // 4. Send Real-time Push Notifications
    const pushPromises = scoredUsers.map((u) => {
      if (u.pushToken) {
        return sendPushNotification(u.pushToken, title, body, { requestId });
      }
    });

    await Promise.all(pushPromises.filter(Boolean));
    console.log(
      `Smart Matching: Dispatched to ${scoredUsers.length} relevant helpers.`,
    );
  } catch (error) {
    console.error("Error in smartMatchRequest:", error);
  }
}

export async function sendDirectNotification(
  userId: string,
  title: string,
  body: string,
  type: string,
  metadata?: any,
) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { pushToken: true },
    });

    if (!user) return;

    await prisma.notification.create({
      data: {
        userId,
        title,
        body,
        type: type as any,
        metadata: metadata || {},
      },
    });

    if (user.pushToken) {
      await sendPushNotification(user.pushToken, title, body, metadata);
    }
  } catch (error) {
    console.error("Error sending direct notification:", error);
  }
}
