-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "travelId" TEXT;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_travelId_fkey" FOREIGN KEY ("travelId") REFERENCES "travels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
