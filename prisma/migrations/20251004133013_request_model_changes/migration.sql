/*
  Warnings:

  - You are about to drop the column `reported_count` on the `Request` table. All the data in the column will be lost.
  - You are about to drop the column `responses_count` on the `Request` table. All the data in the column will be lost.
  - The `category` column on the `Request` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "RequestCategory" AS ENUM ('general', 'shelter', 'food', 'medical', 'transportation', 'financial', 'education', 'employment', 'legal', 'counseling', 'safety', 'other');

-- AlterTable
ALTER TABLE "Request" DROP COLUMN "reported_count",
DROP COLUMN "responses_count",
DROP COLUMN "category",
ADD COLUMN     "category" "RequestCategory" NOT NULL DEFAULT 'general',
ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
