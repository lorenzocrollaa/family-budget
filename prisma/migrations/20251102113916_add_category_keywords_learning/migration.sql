-- CreateIndex
CREATE INDEX "category_keywords_keyword_idx" ON "category_keywords"("keyword");

-- CreateIndex
CREATE INDEX "transactions_userId_isVerified_idx" ON "transactions"("userId", "isVerified");
