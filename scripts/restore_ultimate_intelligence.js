const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const BNLParser = require('../utils/parsers/bnlParser');
const UniCreditParser = require('../utils/parsers/unicreditParser');
const { categorizeUltimate } = require('../utils/ultimateCategorizer');

async function restoreIntelligence() {
  console.log('🚀 RESTORING ULTIMATE INTELLIGENCE (Global DB Repair)\n');

  const bnl = new BNLParser();
  const uc = new UniCreditParser();
  const transactions = await prisma.transaction.findMany();
  
  console.log(`Analyzing ${transactions.length} transactions for repair...`);

  let updatedCount = 0;
  
  for (const tx of transactions) {
    const raw = tx.originalText || '';
    const ucRaw = raw.toUpperCase();

    // 1. DETERMINA IL NOME PULITO (Rilevamento intelligente del tipo di banca)
    let finalDesc = tx.description;
    
    // BNL usa solitamente il sistema a coordinate [XX] del parser PDF
    const isBNLCoords = ucRaw.includes('[50]') || ucRaw.includes('[217]');
    const isBNL = isBNLCoords || ucRaw.includes('BNP PARIBAS') || tx.categoryName === 'BNL';
    
    // UniCredit usa un formato CSV, date con punti (es. 29.12.25), o parole chiave
    const isUC = ucRaw.includes('UNICREDIT') || 
                 ucRaw.includes('BUDDYBANK') || 
                 ucRaw.includes('DISPOSIZIONE') || 
                 ucRaw.includes('CARTA *') ||
                 /^\d{2}\.\d{2}\.\d{2,4}/.test(raw.trim()) ||
                 (!isBNL && (ucRaw.includes('BONIFICO') || raw.includes(',')));
    
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
        if (list[0]) finalDesc = list[0].description;
      } catch (e) {}
    } else if (isUC) {
      const list = [];
      const ucRawTxt = raw.replace(/ \[#\d+\]$/, '');
      try {
        uc.pushParsedTransaction(list, {
          description: ucRawTxt,
          amount: tx.amount,
          isIncome: tx.amount > 0,
          dateStr: tx.date.toISOString()
        }, 0);
        if (list[0]) finalDesc = list[0].description;
      } catch (e) {}
    }

    // 2. RICALCOLA CATEGORIA (MEMORIA-FIRST)
    try {
      const catResult = await categorizeUltimate({
        description: finalDesc,
        amount: parseFloat(tx.amount)
      }, tx.userId);

      const hasDescChanged = finalDesc !== tx.description;
      const hasCatChanged = catResult.category !== tx.category;

      if (hasDescChanged || hasCatChanged) {
        await prisma.transaction.update({
          where: { id: tx.id },
          data: { 
            description: finalDesc,
            category: catResult.category,
            confidence: catResult.confidence,
            categorizationReason: catResult.reason || 'Intelligence restoration'
          }
        });
        updatedCount++;
        if (updatedCount % 100 === 0) process.stdout.write('.');
      }
    } catch (e) {
      console.error(`Error on TX ${tx.id}:`, e.message);
    }
  }

  console.log(`\n\n✅ INTELLIGENCE RESTORED!`);
  console.log(`Total transactions repaired: ${updatedCount}`);
  await prisma.$disconnect();
}

restoreIntelligence();
