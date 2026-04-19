const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const BNLParser = require('../utils/parsers/bnlParser');

async function fixBNL() {
  console.log('🚀 REPAIRING BNL DESCRIPTIONS (Aggressive Signature Detection)\n');

  const bnl = new BNLParser();
  const transactions = await prisma.transaction.findMany();
  
  console.log(`Analyzing ${transactions.length} transactions...`);

  let updatedCount = 0;
  
  for (const tx of transactions) {
    const raw = tx.originalText || '';
    const ucRaw = raw.toUpperCase();

    // Firme BNL ultra-estese
    const isBNL = ucRaw.includes('BNL') || 
                  ucRaw.includes('BNP PARIBAS') || 
                  ucRaw.includes('QUALI SONO TUTTI I MOVIMENTI') || 
                  ucRaw.includes('ESERCENTE') || 
                  ucRaw.includes('PAG MAESTRO') || 
                  tx.bank === 'BNL';

    if (isBNL) {
      const list = [];
      const bnlRaw = raw.replace(/ \[#\d+\]$/, '');
      
      try {
        bnl.pushBNLTransaction(list, {
          description: bnlRaw,
          amount: Math.abs(tx.amount),
          xCoord: tx.amount < 0 ? 100 : 600, 
          date: tx.date.toISOString(),
          originalLines: [bnlRaw]
        }, 0);

        if (list[0] && list[0].description !== tx.description) {
          await prisma.transaction.update({
            where: { id: tx.id },
            data: { description: list[0].description }
          });
          updatedCount++;
          if (updatedCount % 50 === 0) process.stdout.write('.');
        }
      } catch (e) {
        console.error(`Error on TX ${tx.id}:`, e.message);
      }
    }
  }

  console.log(`\n\n✅ BNL REPAIR FINISHED!`);
  console.log(`Total BNL/Esercente transactions cleaned: ${updatedCount}`);
  await prisma.$disconnect();
}

fixBNL();
