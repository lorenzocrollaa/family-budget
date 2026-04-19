/*
  Warnings:

  - You are about to drop the `category_keywords` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."category_keywords" DROP CONSTRAINT "category_keywords_userId_fkey";

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "categorizationReason" TEXT;

-- DropTable
DROP TABLE "public"."category_keywords";
