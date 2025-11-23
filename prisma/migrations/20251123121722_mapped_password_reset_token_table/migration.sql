/*
  Warnings:

  - You are about to drop the column `expiresAt` on the `PasswordResetToken` table. All the data in the column will be lost.
  - You are about to drop the column `tokenHash` on the `PasswordResetToken` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `PasswordResetToken` table. All the data in the column will be lost.
  - Added the required column `expires_at` to the `PasswordResetToken` table without a default value. This is not possible if the table is not empty.
  - Added the required column `token_hash` to the `PasswordResetToken` table without a default value. This is not possible if the table is not empty.
  - Added the required column `user_id` to the `PasswordResetToken` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "public"."PasswordResetToken" DROP CONSTRAINT "PasswordResetToken_userId_fkey";

-- AlterTable
ALTER TABLE "PasswordResetToken" DROP COLUMN "expiresAt",
DROP COLUMN "tokenHash",
DROP COLUMN "userId",
ADD COLUMN     "expires_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "token_hash" TEXT NOT NULL,
ADD COLUMN     "user_id" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
