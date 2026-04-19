ALTER TABLE "users" ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'free';
ALTER TABLE "users" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "users" ADD COLUMN "stripeSubId" TEXT;
ALTER TABLE "users" ADD COLUMN "planExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "users_stripeCustomerId_key" ON "users"("stripeCustomerId");
CREATE UNIQUE INDEX "users_stripeSubId_key" ON "users"("stripeSubId");
