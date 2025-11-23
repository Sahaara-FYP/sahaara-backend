/*
  Warnings:

  - The values [unverified] on the enum `VerificationStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "VerificationStatus_new" AS ENUM ('pending', 'verified', 'rejected');
ALTER TABLE "public"."Verification" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Verification" ALTER COLUMN "status" TYPE "VerificationStatus_new" USING ("status"::text::"VerificationStatus_new");
ALTER TYPE "VerificationStatus" RENAME TO "VerificationStatus_old";
ALTER TYPE "VerificationStatus_new" RENAME TO "VerificationStatus";
DROP TYPE "public"."VerificationStatus_old";
ALTER TABLE "Verification" ALTER COLUMN "status" SET DEFAULT 'pending';
COMMIT;
