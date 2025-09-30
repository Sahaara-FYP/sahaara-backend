-- AlterTable
ALTER TABLE "public"."Alert" ALTER COLUMN "description" DROP NOT NULL,
ALTER COLUMN "category" SET DEFAULT 'general',
ALTER COLUMN "urgency_level" SET DEFAULT 'normal';
