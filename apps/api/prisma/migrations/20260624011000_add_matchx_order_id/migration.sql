ALTER TABLE "Order" ADD COLUMN "matchxOrderId" BIGINT;

CREATE UNIQUE INDEX "Order_matchxOrderId_key" ON "Order"("matchxOrderId");
CREATE INDEX "Order_matchxOrderId_idx" ON "Order"("matchxOrderId");
