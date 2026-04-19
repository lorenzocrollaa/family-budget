const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function rollback() {
  console.log('🚀 INITIALIZING DATABASE ROLLBACK (Restoring Stable State)\n');

  const transactions = await prisma.transaction.findMany();
  console.log(`Found ${transactions.length} transactions to rollback.`);

  let updatedCount = 0;
  
  for (const tx of transactions) {
    if (!tx.originalText) continue;

    // Logica di rollback: Riprendi il testo originale e togli solo i metadati tecnici
    let restoredDesc = tx.originalText
      .replace(/ \[#\d+\]$/g, '') // Togli ID database finale
      .replace(/\[\d+\]/g, ' ')   // Togli coordinate bracketed
      .replace(/\s+/g, ' ')       // Normalizza spazi
      .trim();

    if (restoredDesc !== tx.description) {
      await prisma.transaction.update({
        where: { id: tx.id },
        data: { 
          description: restoredDesc
        }
      });
      updatedCount++;
      if (updatedCount % 100 === 0) process.stdout.write('.');
    }
  }

  console.log(`\n\n✅ ROLLBACK FINISHED!`);
  console.log(`Total transactions restored to original state: ${updatedCount}`);
  await prisma.$disconnect();
}

rollback();
