/*
  Warnings:

  - A unique constraint covering the columns `[created_at,id]` on the table `Request` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Request_created_at_id_key" ON "Request"("created_at", "id");
