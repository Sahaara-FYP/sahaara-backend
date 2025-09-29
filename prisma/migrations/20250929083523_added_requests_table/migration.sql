-- CreateEnum
CREATE TYPE "public"."UrgencyLevel" AS ENUM ('normal', 'high', 'low');

-- CreateEnum
CREATE TYPE "public"."RequestStatus" AS ENUM ('pending', 'partially_accepted', 'accepted', 'completed', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "public"."ModerationStatus" AS ENUM ('clean', 'flagged', 'reviewed', 'blocked');

-- CreateTable
CREATE TABLE "public"."Request" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "urgency_level" "public"."UrgencyLevel" NOT NULL DEFAULT 'normal',
    "status" "public"."RequestStatus" NOT NULL DEFAULT 'pending',
    "location_lat" DOUBLE PRECISION NOT NULL,
    "location_lng" DOUBLE PRECISION NOT NULL,
    "radius_meters" INTEGER NOT NULL DEFAULT 1000,
    "post_anonymously" BOOLEAN NOT NULL DEFAULT false,
    "visibility_verified_only" BOOLEAN NOT NULL DEFAULT false,
    "priority_score" DOUBLE PRECISION DEFAULT 0,
    "visibility_women_only" BOOLEAN NOT NULL DEFAULT false,
    "reported_count" INTEGER NOT NULL DEFAULT 0,
    "moderation_status" "public"."ModerationStatus" NOT NULL DEFAULT 'clean',
    "responses_count" INTEGER NOT NULL DEFAULT 0,
    "allow_multiple_helpers" BOOLEAN NOT NULL DEFAULT false,
    "max_helpers" INTEGER,
    "completed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "attachments" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Request_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "public"."Request" ADD CONSTRAINT "Request_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
