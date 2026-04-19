-- CreateTable
CREATE TABLE "category_keywords" (
    "id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "isUserDefined" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "category_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "category_keywords_userId_idx" ON "category_keywords"("userId");

-- CreateIndex
CREATE INDEX "category_keywords_keyword_idx" ON "category_keywords"("keyword");

-- CreateIndex
CREATE UNIQUE INDEX "category_keywords_keyword_userId_key" ON "category_keywords"("keyword", "userId");

-- AddForeignKey
ALTER TABLE "category_keywords" ADD CONSTRAINT "category_keywords_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
