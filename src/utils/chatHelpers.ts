import prisma from "./prisma.js";

/**
 * Create a group ChatRoom for a newly-created Offer or Request.
 * The owner is automatically added as a participant.
 */
export async function createGroupRoom(
  ownerId: string,
  context: { offerId?: string; requestId?: string },
) {
  const room = await prisma.chatRoom.create({
    data: {
      type: "group",
      status: "active",
      ...(context.offerId ? { offerId: context.offerId } : {}),
      ...(context.requestId ? { requestId: context.requestId } : {}),
      participants: {
        create: { userId: ownerId },
      },
    },
  });
  return room;
}

/**
 * When an interaction is accepted:
 *  1. Create a direct ChatRoom between the owner and the requester.
 *  2. Add the requester to the existing group ChatRoom.
 */
export async function onInteractionAccepted(
  ownerId: string,
  requesterId: string,
  context: { offerId?: string; requestId?: string },
) {
  // Find the existing group room for the offer/request
  const groupRoom = await prisma.chatRoom.findFirst({
    where: {
      type: "group",
      status: "active",
      ...(context.offerId ? { offerId: context.offerId } : {}),
      ...(context.requestId ? { requestId: context.requestId } : {}),
    },
  });

  await Promise.all([
    // 1. Create the direct room
    prisma.chatRoom.create({
      data: {
        type: "direct",
        status: "active",
        ...(context.offerId ? { offerId: context.offerId } : {}),
        ...(context.requestId ? { requestId: context.requestId } : {}),
        participants: {
          createMany: {
            data: [{ userId: ownerId }, { userId: requesterId }],
            skipDuplicates: true,
          },
        },
      },
    }),
    // 2. Add the requester to the group room (if found)
    groupRoom
      ? prisma.chatParticipant.upsert({
          where: {
            roomId_userId: { roomId: groupRoom.id, userId: requesterId },
          },
          update: {},
          create: { roomId: groupRoom.id, userId: requesterId },
        })
      : Promise.resolve(),
  ]);
}

/**
 * Close all ChatRooms for an Offer or Request (e.g., when offer is completed/cancelled).
 */
export async function closeAllRoomsForContext(context: {
  offerId?: string;
  requestId?: string;
}) {
  await prisma.chatRoom.updateMany({
    where: {
      status: "active",
      ...(context.offerId ? { offerId: context.offerId } : {}),
      ...(context.requestId ? { requestId: context.requestId } : {}),
    },
    data: { status: "closed" },
  });
}

/**
 * Close only the direct room between an owner and a requester for a given context.
 * Used when a single interaction is withdrawn/rejected.
 */
export async function closeDirectRoomForInteraction(
  ownerId: string,
  requesterId: string,
  context: { offerId?: string; requestId?: string },
) {
  // Find a direct room that both users participate in for this context
  const directRoom = await prisma.chatRoom.findFirst({
    where: {
      type: "direct",
      status: "active",
      ...(context.offerId ? { offerId: context.offerId } : {}),
      ...(context.requestId ? { requestId: context.requestId } : {}),
      participants: { some: { userId: ownerId } },
    },
    include: { participants: true },
  });

  if (!directRoom) return;

  const participantIds = directRoom.participants.map((p) => p.userId);
  const hasRequester = participantIds.includes(requesterId);
  if (!hasRequester) return;

  await prisma.chatRoom.update({
    where: { id: directRoom.id },
    data: { status: "closed" },
  });

  // Also remove requester from the group room
  const groupRoom = await prisma.chatRoom.findFirst({
    where: {
      type: "group",
      status: "active",
      ...(context.offerId ? { offerId: context.offerId } : {}),
      ...(context.requestId ? { requestId: context.requestId } : {}),
    },
  });

  if (groupRoom) {
    await prisma.chatParticipant.delete({
      where: {
        roomId_userId: { roomId: groupRoom.id, userId: requesterId },
      },
    });
  }
}
