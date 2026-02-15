-- CreateEnum
CREATE TYPE "OfferType" AS ENUM ('RESOURCE', 'SERVICE');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DEPLETED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InteractionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'FULFILLED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "category" "RequestCategory" NOT NULL DEFAULT 'general',
    "type" "OfferType" NOT NULL DEFAULT 'SERVICE',
    "status" "OfferStatus" NOT NULL DEFAULT 'ACTIVE',
    "moderation_status" "ModerationStatus" NOT NULL DEFAULT 'clean',
    "location_lat" DECIMAL(10,7) NOT NULL,
    "location_lng" DECIMAL(10,7) NOT NULL,
    "total_quantity" INTEGER,
    "remaining_quantity" INTEGER,
    "unit" VARCHAR(50),
    "availability" VARCHAR(255),
    "experience_desc" TEXT,
    "attachments" JSONB,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferInteraction" (
    "id" TEXT NOT NULL,
    "offer_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "InteractionStatus" NOT NULL DEFAULT 'PENDING',
    "requested_quantity" INTEGER,
    "message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Offer_created_at_id_key" ON "Offer"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "OfferInteraction_offer_id_user_id_key" ON "OfferInteraction"("offer_id", "user_id");

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferInteraction" ADD CONSTRAINT "OfferInteraction_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferInteraction" ADD CONSTRAINT "OfferInteraction_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
