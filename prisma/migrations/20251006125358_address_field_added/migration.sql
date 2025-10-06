/*
  Warnings:

  - You are about to drop the column `adminNotes` on the `Verification` table. All the data in the column will be lost.
  - You are about to drop the column `cnicBackUrl` on the `Verification` table. All the data in the column will be lost.
  - You are about to drop the column `cnicFrontUrl` on the `Verification` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `Verification` table. All the data in the column will be lost.
  - You are about to drop the column `selfieWithCnicUrl` on the `Verification` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `Verification` table. All the data in the column will be lost.
  - You are about to drop the column `verifiedAt` on the `Verification` table. All the data in the column will be lost.
  - Added the required column `cnic_back_url` to the `Verification` table without a default value. This is not possible if the table is not empty.
  - Added the required column `cnic_front_url` to the `Verification` table without a default value. This is not possible if the table is not empty.
  - Added the required column `selfie_with_cnic_url` to the `Verification` table without a default value. This is not possible if the table is not empty.
  - Added the required column `user_id` to the `Verification` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "public"."Verification" DROP CONSTRAINT "Verification_userId_fkey";

-- AlterTable
ALTER TABLE "Verification" DROP COLUMN "adminNotes",
DROP COLUMN "cnicBackUrl",
DROP COLUMN "cnicFrontUrl",
DROP COLUMN "createdAt",
DROP COLUMN "selfieWithCnicUrl",
DROP COLUMN "userId",
DROP COLUMN "verifiedAt",
ADD COLUMN     "admin_notes" TEXT,
ADD COLUMN     "cnic_back_url" TEXT NOT NULL,
ADD COLUMN     "cnic_front_url" TEXT NOT NULL,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "selfie_with_cnic_url" TEXT NOT NULL,
ADD COLUMN     "user_id" TEXT NOT NULL,
ADD COLUMN     "verified_at" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Verification" ADD CONSTRAINT "Verification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
