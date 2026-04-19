const { PrismaClient } = require('@prisma/client');
const { intelligentNoiseRemoval } = require('../utils/ultimateCategorizer');
const prisma = new PrismaClient();

const DRY_RUN = process.env.COMMIT !== 'true';

async function bulkClean() {
  console.log(`\n🚀 BULK CLEANING DESCRIPTIONS (${DRY_RUN ? 'DRY RUN' : 'COMMIT MODE'})\n`);

  try {
    // Trova TUTTE le transazioni che hanno un testo originale su cui lavorare
    const transactions = await prisma.transaction.findMany({
      where: {
        originalText: { not: null }
      },
      orderBy: { date: 'desc' }
    });

    console.log(`found ${transactions.length} transactions to check...\n`);

    let updatedCount = 0;
    const samples = [];

    for (const t of transactions) {
      const source = t.originalText; // Usa SEMPRE originalText per precisione massima
      let cleanDesc = intelligentNoiseRemoval(source);

      // SANITY CHECK: Se la descrizione pulita è troppo lunga, probabilmente abbiamo preso noise di footer
      if (cleanDesc.length > 100) {
        cleanDesc = cleanDesc.substring(0, 100).trim();
      }

      if (cleanDesc !== t.description && cleanDesc.length > 0) {
        if (samples.length < 20) {
          samples.push({
            before: t.description,
            after: cleanDesc,
            source: source.substring(0, 50) + (source.length > 50 ? '...' : '')
          });
        }

        if (!DRY_RUN) {
          await prisma.transaction.update({
            where: { id: t.id },
            data: { description: cleanDesc }
          });
        }
        updatedCount++;
      }
    }

    console.log('--- SAMPLE TRANSFORMATIONS ---');
    samples.forEach((s, i) => {
      console.log(`${i+1}. BEFORE: "${s.before}"`);
      console.log(`   AFTER:  "${s.after}"`);
      console.log(`   SOURCE: "${s.source}"\n`);
    });

    console.log(`--- SUMMARY ---`);
    console.log(`Total transactions checked: ${transactions.length}`);
    console.log(`Transactions ${DRY_RUN ? 'that would be' : ''} updated: ${updatedCount}`);
    
    if (DRY_RUN) {
      console.log(`\n⚠️  This was a DRY RUN. Run with COMMIT=true to apply changes.`);
    }

  } catch (error) {
    console.error('❌ Error during bulk cleaning:', error);
  } finally {
    await prisma.$disconnect();
  }
}

bulkClean();
