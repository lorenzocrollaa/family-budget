const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const BNLParser = require('../utils/parsers/bnlParser');
const { categorizeTransaction } = require('../utils/ultimateCategorizer');

async function maximizeBNL() {
  console.log('🚀 MAXIMIZING BNL & REPAIRING CATEGORIES (Final Phase)\n');

  const bnl = new BNLParser();
  const transactions = await prisma.transaction.findMany();
  
  console.log(`Analyzing ${transactions.length} transactions for BNL/Esercente...`);

  let updatedCount = 0;
  
  for (const tx of transactions) {
    const raw = tx.originalText || '';
    const ucRaw = raw.toUpperCase();

    // Firme BNL (esercente è ora il trigger principale per le BNL orfane)
    const isBNL = ucRaw.includes('BNL') || 
                  ucRaw.includes('BNP PARIBAS') || 
                  ucRaw.includes('ESERCENTE') || 
                  ucRaw.includes('PAG MAESTRO') || 
                  tx.bank === 'BNL';

    if (isBNL) {
      const list = [];
      const bnlRaw = raw.replace(/ \[#\d+\]$/, '');
      
      try {
        bnl.pushBNLTransaction(list, {
          description: bnlRaw,
          amount: tx.amount,
          xCoord: tx.amount < 0 ? 100 : 600, 
          date: tx.date.toISOString(),
          originalLines: [bnlRaw]
        }, 0);

        if (list[0]) {
          const newDesc = list[0].description;
          
          // Ricalcola Categoria basata sul nome pulito!
          const catResult = categorizeTransaction(newDesc, tx.amount);
          
          const hasDescChanged = newDesc !== tx.description;
          const hasCatChanged = catResult.category !== tx.category;

          if (hasDescChanged || hasCatChanged) {
            await prisma.transaction.update({
              where: { id: tx.id },
              data: { 
                description: newDesc,
                category: catResult.category,
                categorizationReason: catResult.reason || 'Keyword fixed'
              }
            });
            updatedCount++;
            if (updatedCount % 50 === 0) process.stdout.write('.');
          }
        }
      } catch (e) {
        console.error(`Error on TX ${tx.id}:`, e.message);
      }
    }
  }

  console.log(`\n\n✅ BNL MAXIMIZATION FINISHED!`);
  console.log(`Total BNL transactions corrected & categorized: ${updatedCount}`);
  await prisma.$disconnect();
}

maximizeBNL();
