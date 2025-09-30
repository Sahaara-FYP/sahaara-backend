/*
  Warnings:

  - You are about to drop the column `allow_multiple_helpers` on the `Request` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."Request" DROP COLUMN "allow_multiple_helpers";
