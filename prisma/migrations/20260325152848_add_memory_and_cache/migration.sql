-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "isMemory" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "merchant_cache" (
    "id" TEXT NOT NULL,
    "merchantName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "googleType" TEXT,
    "location" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "merchant_cache_merchantName_key" ON "merchant_cache"("merchantName");

-- CreateIndex
CREATE INDEX "merchant_cache_merchantName_idx" ON "merchant_cache"("merchantName");

-- CreateIndex
CREATE INDEX "transactions_userId_isMemory_idx" ON "transactions"("userId", "isMemory");
