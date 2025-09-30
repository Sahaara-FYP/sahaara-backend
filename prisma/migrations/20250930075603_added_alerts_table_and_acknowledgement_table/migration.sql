-- CreateEnum
CREATE TYPE "public"."AlertStatus" AS ENUM ('active', 'resolved', 'expired', 'cancelled');

-- CreateTable
CREATE TABLE "public"."Alert" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "urgency_level" "public"."UrgencyLevel" NOT NULL,
    "location_lat" DECIMAL(10,7) NOT NULL,
    "location_lng" DECIMAL(10,7) NOT NULL,
    "attachments" JSONB,
    "status" "public"."AlertStatus" NOT NULL DEFAULT 'active',
    "moderation_status" "public"."ModerationStatus" NOT NULL DEFAULT 'clean',
    "expiry_time" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AlertAcknowledgement" (
    "id" TEXT NOT NULL,
    "alert_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AlertAcknowledgement_alert_id_user_id_key" ON "public"."AlertAcknowledgement"("alert_id", "user_id");

-- AddForeignKey
ALTER TABLE "public"."Alert" ADD CONSTRAINT "Alert_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AlertAcknowledgement" ADD CONSTRAINT "AlertAcknowledgement_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "public"."Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AlertAcknowledgement" ADD CONSTRAINT "AlertAcknowledgement_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
