/*
  Warnings:

  - The values [PENDING,ACCEPTED,REJECTED,FULFILLED,CANCELLED] on the enum `InteractionStatus` will be removed. If these variants are still used in the database, this will fail.
  - The values [ACTIVE,PAUSED,DEPLETED,COMPLETED,CANCELLED] on the enum `OfferStatus` will be removed. If these variants are still used in the database, this will fail.
  - The values [RESOURCE,SERVICE] on the enum `OfferType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "InteractionStatus_new" AS ENUM ('pending', 'accepted', 'rejected', 'fulfilled', 'cancelled');
ALTER TABLE "public"."OfferInteraction" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "OfferInteraction" ALTER COLUMN "status" TYPE "InteractionStatus_new" USING ("status"::text::"InteractionStatus_new");
ALTER TYPE "InteractionStatus" RENAME TO "InteractionStatus_old";
ALTER TYPE "InteractionStatus_new" RENAME TO "InteractionStatus";
DROP TYPE "public"."InteractionStatus_old";
ALTER TABLE "OfferInteraction" ALTER COLUMN "status" SET DEFAULT 'pending';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "OfferStatus_new" AS ENUM ('active', 'paused', 'depleted', 'completed', 'cancelled');
ALTER TABLE "public"."Offer" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Offer" ALTER COLUMN "status" TYPE "OfferStatus_new" USING ("status"::text::"OfferStatus_new");
ALTER TYPE "OfferStatus" RENAME TO "OfferStatus_old";
ALTER TYPE "OfferStatus_new" RENAME TO "OfferStatus";
DROP TYPE "public"."OfferStatus_old";
ALTER TABLE "Offer" ALTER COLUMN "status" SET DEFAULT 'active';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "OfferType_new" AS ENUM ('resource', 'service');
ALTER TABLE "public"."Offer" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "Offer" ALTER COLUMN "type" TYPE "OfferType_new" USING ("type"::text::"OfferType_new");
ALTER TYPE "OfferType" RENAME TO "OfferType_old";
ALTER TYPE "OfferType_new" RENAME TO "OfferType";
DROP TYPE "public"."OfferType_old";
ALTER TABLE "Offer" ALTER COLUMN "type" SET DEFAULT 'service';
COMMIT;

-- AlterTable
ALTER TABLE "Offer" ALTER COLUMN "type" SET DEFAULT 'service',
ALTER COLUMN "status" SET DEFAULT 'active';

-- AlterTable
ALTER TABLE "OfferInteraction" ALTER COLUMN "status" SET DEFAULT 'pending';
