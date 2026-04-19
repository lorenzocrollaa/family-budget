const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const BNLParser = require('../utils/parsers/bnlParser');
const UniCreditParser = require('../utils/parsers/unicreditParser');
const MpsParser = require('../utils/parsers/mpsParser');

async function reprocess() {
  console.log('🚀 INITIALIZING DATABASE RE-PROCESSING (Premium Cleaning - Fixed)\n');

  const bnl = new BNLParser();
  const uni = new UniCreditParser();
  const mps = new MpsParser();

  const transactions = await prisma.transaction.findMany();
  console.log(`Found ${transactions.length} transactions to re-process.`);

  let updatedCount = 0;
  
  for (const tx of transactions) {
    let cleanDesc = tx.description;

    // Determina quale parser usare in base al testo originale
    const raw = tx.originalText || '';
    const ucRaw = raw.toUpperCase();

    try {
      if (ucRaw.includes('MONTE DEI PASCHI')) {
        const list = [];
        mps.pushParsedTransaction(list, {
          description: raw.replace(/ \[#\d+\]$/, ''),
          amount: Math.abs(tx.amount),
          isIncome: tx.amount > 0,
          dateStr: tx.date.toISOString()
        });
        if (list[0]) cleanDesc = list[0].description;
      } 
      else if (ucRaw.includes('BNL') || ucRaw.includes('BNP PARIBAS') || ucRaw.includes('QUALI SONO TUTTI I MOVIMENTI')) {
        const list = [];
        // Per BNL, passiamo il testo originale pulito dal marker ID finale
        const bnlRaw = raw.replace(/ \[#\d+\]$/, '');
        bnl.pushBNLTransaction(list, {
          description: bnlRaw,
          amount: Math.abs(tx.amount),
          xCoord: tx.amount < 0 ? 100 : 600, 
          date: tx.date.toISOString(),
          originalLines: [bnlRaw]
        }, 0);
        if (list[0]) cleanDesc = list[0].description;
      }
      else if (ucRaw.includes('UNICREDIT') || ucRaw.includes('BUDDYBANK') || ucRaw.includes('ELENCO OPERAZIONI')) {
        const list = [];
        uni.pushParsedTransaction(list, {
          description: raw.replace(/ \[#\d+\]$/, ''),
          amount: Math.abs(tx.amount),
          isIncome: tx.amount > 0,
          dateStr: tx.date.toISOString()
        }, 0);
        if (list[0]) cleanDesc = list[0].description;
      }

      if (cleanDesc !== tx.description) {
        await prisma.transaction.update({
          where: { id: tx.id },
          data: { 
            description: cleanDesc
          }
        });
        updatedCount++;
        if (updatedCount % 100 === 0) process.stdout.write('.');
      }
    } catch (e) {
      console.error(`\nError processing TX ${tx.id}:`, e.message);
    }
  }

  console.log(`\n\n✅ FINISHED!`);
  console.log(`Total updated: ${updatedCount}`);
  await prisma.$disconnect();
}

reprocess();
