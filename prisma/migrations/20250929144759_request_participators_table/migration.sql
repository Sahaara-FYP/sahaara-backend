-- CreateEnum
CREATE TYPE "public"."ParticipationStatus" AS ENUM ('pending', 'accepted', 'rejected');

-- DropForeignKey
ALTER TABLE "public"."Request" DROP CONSTRAINT "Request_user_id_fkey";

-- CreateTable
CREATE TABLE "public"."RequestParticipator" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "public"."ParticipationStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestParticipator_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RequestParticipator_request_id_user_id_key" ON "public"."RequestParticipator"("request_id", "user_id");

-- AddForeignKey
ALTER TABLE "public"."Request" ADD CONSTRAINT "Request_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestParticipator" ADD CONSTRAINT "RequestParticipator_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "public"."Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequestParticipator" ADD CONSTRAINT "RequestParticipator_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
