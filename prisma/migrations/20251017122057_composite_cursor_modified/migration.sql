/*
  Warnings:

  - A unique constraint covering the columns `[created_at,id]` on the table `Alert` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[created_at,id]` on the table `RequestParticipator` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Alert_created_at_id_key" ON "Alert"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RequestParticipator_created_at_id_key" ON "RequestParticipator"("created_at", "id");
