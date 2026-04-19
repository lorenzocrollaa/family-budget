const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function masterReset() {
  console.log('🛑 MASTER RESET STARTING...');
  console.log('This will delete all Transactions and reset Category sums.');

  try {
    // 1. Delete all transactions
    const deletedCount = await prisma.transaction.deleteMany();
    console.log(`✅ Deleted ${deletedCount.count} transactions.`);

    // 2. Reset category totals
    const resetCategories = await prisma.category.updateMany({
      data: {
        totalAmount: 0,
        transactionCount: 0,
        lastUsed: null
      }
    });
    console.log(`✅ Reset ${resetCategories.count} categories.`);

    // 3. Clear file imports history (if any)
    // Add logic here if there is a table for file imports
    
    console.log('✨ DATABASE IS NOW CLEAN. Ready for the Maximum Quality Import.');
  } catch (error) {
    console.error('❌ Reset failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

masterReset();
