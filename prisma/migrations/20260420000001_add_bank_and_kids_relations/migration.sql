-- Create bank_connections table
CREATE TABLE IF NOT EXISTS "bank_connections" (
    "id" TEXT NOT NULL,
    "accessToken" TEXT,
    "itemId" TEXT,
    "institutionId" TEXT NOT NULL,
    "institutionName" TEXT NOT NULL DEFAULT 'Banca Sconosciuta',
    "institutionLogo" TEXT,
    "institutionColor" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "cursor" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bank_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "bank_connections_accessToken_key" ON "bank_connections"("accessToken");
CREATE UNIQUE INDEX IF NOT EXISTS "bank_connections_itemId_key" ON "bank_connections"("itemId");

ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create bank_accounts table
CREATE TABLE IF NOT EXISTS "bank_accounts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "iban" TEXT,
    "ownerName" TEXT,
    "name" TEXT,
    "balance" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "lastSync" TIMESTAMP(3),
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isConnected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "bank_accounts_accountId_connectionId_key" ON "bank_accounts"("accountId", "connectionId");

ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "bank_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add missing columns to transactions
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "kidId" TEXT;
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "bankAccountId" TEXT;
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "providerTransactionId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "transactions_providerTransactionId_key" ON "transactions"("providerTransactionId") WHERE "providerTransactionId" IS NOT NULL;

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_kidId_fkey"
    FOREIGN KEY ("kidId") REFERENCES "kids"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_bankAccountId_fkey"
    FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add indexes
CREATE INDEX IF NOT EXISTS "transactions_userId_kidId_idx" ON "transactions"("userId", "kidId");
CREATE INDEX IF NOT EXISTS "transactions_userId_bankAccountId_idx" ON "transactions"("userId", "bankAccountId");
