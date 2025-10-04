/*
  Warnings:

  - The `category` column on the `Alert` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "AlertCategory" AS ENUM ('general', 'emergency', 'health', 'security', 'weather', 'traffic', 'missing_person', 'lost_and_found', 'natural_disaster', 'community_notice', 'event', 'other');

-- AlterTable
ALTER TABLE "Alert" DROP COLUMN "category",
ADD COLUMN     "category" "AlertCategory" NOT NULL DEFAULT 'general',
ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "AlertAcknowledgement" ADD COLUMN     "comments" TEXT;

-- AlterTable
ALTER TABLE "RequestParticipator" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "gender" SET DEFAULT 'male',
ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
