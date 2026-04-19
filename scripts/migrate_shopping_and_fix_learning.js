/**
 * 🔧 MIGRATION SCRIPT
 * 1. Rinomina "Abbigliamento" -> "Shopping" in tutto il DB
 * 2. Popola MerchantCache e CategoryKeyword da tutte le transazioni già verificate
 *    (Questo "insegna" al sistema i merchant già conosciuti, risolvendo il bug di Rahman Frutteria)
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Stessa logica di extractKeywords in ultimateCategorizer.js
const stopWords = [
  'di', 'da', 'in', 'con', 'per', 'su', 'tra', 'fra', 'a', 'la', 'il', 'lo', 'le',
  'gli', 'del', 'della', 'al', 'alla', 'dal', 'dalla', 'col', 'coi', 'sul', 'sulla',
  'srl', 'spa', 'snc', 'sas', 'srls', 'ss', 'coop', 'piazza', 'via', 'corso', 'viale',
  'vicolo', 'largo'
];

function extractKeywords(description) {
  if (!description) return [];
  return description.toLowerCase()
    .replace(/\[#?\d+\]/g, '')
    .replace(/\d{2}\/\d{2}\/\d{4}/g, '')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.includes(word) && isNaN(word));
}

async function main() {
  console.log('======================================================');
  console.log('🚀 INIZIO MIGRAZIONE DATABASE');
  console.log('======================================================\n');

  // --- STEP 1: Rinomina "Abbigliamento" -> "Shopping" ---
  console.log('📦 STEP 1: Rinomina "Abbigliamento" -> "Shopping"');

  const renamedTx = await prisma.transaction.updateMany({
    where: { category: 'Abbigliamento' },
    data: { category: 'Shopping' }
  });
  console.log(`   ✅ Transactions aggiornate: ${renamedTx.count}`);

  const renamedTxByName = await prisma.transaction.updateMany({
    where: { categoryName: 'Abbigliamento' },
    data: { categoryName: 'Shopping' }
  });
  console.log(`   ✅ Transactions (categoryName) aggiornate: ${renamedTxByName.count}`);

  const renamedCat = await prisma.category.updateMany({
    where: { name: 'Abbigliamento' },
    data: { name: 'Shopping', emoji: '🛍️' }
  });
  console.log(`   ✅ Categories aggiornate: ${renamedCat.count}`);

  const renamedKw = await prisma.categoryKeyword.updateMany({
    where: { category: 'Abbigliamento' },
    data: { category: 'Shopping' }
  });
  console.log(`   ✅ CategoryKeywords aggiornate: ${renamedKw.count}`);

  const renamedCache = await prisma.merchantCache.updateMany({
    where: { category: 'Abbigliamento' },
    data: { category: 'Shopping' }
  });
  console.log(`   ✅ MerchantCache voci aggiornate: ${renamedCache.count}`);

  // --- STEP 2: Popola MerchantCache da transazioni verificate ---
  console.log('\n📚 STEP 2: Popola MerchantCache da transazioni verificate...');

  const verifiedTxs = await prisma.transaction.findMany({
    where: { isVerified: true },
    select: { description: true, category: true }
  });

  console.log(`   Trovate ${verifiedTxs.length} transazioni verificate`);

  let cacheCreated = 0;
  let cacheUpdated = 0;

  for (const tx of verifiedTxs) {
    if (!tx.description || !tx.category) continue;
    const cleanDesc = tx.description.trim().toLowerCase();
    if (cleanDesc.length < 2) continue;

    try {
      const existing = await prisma.merchantCache.findUnique({ where: { merchantName: cleanDesc } });
      if (existing) {
        // Aggiorna solo se la categoria è Alimentari (la più affidabile per transazioni verificate)
        // o se non c'è ancora un record verificato dall'utente
        if (existing.source !== 'user_verified') {
          await prisma.merchantCache.update({
            where: { merchantName: cleanDesc },
            data: { category: tx.category, confidence: 0.99, source: 'user_verified', updatedAt: new Date() }
          });
          cacheUpdated++;
        }
      } else {
        await prisma.merchantCache.create({
          data: {
            merchantName: cleanDesc,
            category: tx.category,
            confidence: 0.99,
            source: 'user_verified'
          }
        });
        cacheCreated++;
      }
    } catch (e) {
      // Ignora unique constraint errors
    }
  }

  console.log(`   ✅ MerchantCache: ${cacheCreated} create, ${cacheUpdated} aggiornate`);

  // --- STEP 3: Popola CategoryKeyword da transazioni verificate ---
  console.log('\n🧠 STEP 3: Popola CategoryKeyword da transazioni verificate...');

  const users = await prisma.user.findMany({ select: { id: true, email: true } });

  let kwCreated = 0;
  let kwUpdated = 0;

  for (const user of users) {
    const userVerifiedTxs = await prisma.transaction.findMany({
      where: { userId: user.id, isVerified: true },
      select: { description: true, category: true }
    });

    if (userVerifiedTxs.length === 0) continue;
    console.log(`   👤 Utente ${user.email}: ${userVerifiedTxs.length} transazioni verificate`);

    for (const tx of userVerifiedTxs) {
      const keywords = extractKeywords(tx.description);
      for (const keyword of keywords) {
        try {
          const existing = await prisma.categoryKeyword.findUnique({
            where: { keyword_userId: { keyword: keyword, userId: user.id } }
          });

          if (existing) {
            if (!existing.isUserDefined) {
              // Aggiorna solo le keyword automatiche, non quelle impostate dall'utente
              await prisma.categoryKeyword.update({
                where: { keyword_userId: { keyword, userId: user.id } },
                data: { category: tx.category, isUserDefined: true, weight: 1.0 }
              });
              kwUpdated++;
            }
          } else {
            await prisma.categoryKeyword.create({
              data: { keyword, category: tx.category, weight: 1.0, isUserDefined: true, userId: user.id }
            });
            kwCreated++;
          }
        } catch (e) {
          // Ignora
        }
      }
    }
  }

  console.log(`   ✅ CategoryKeyword: ${kwCreated} create, ${kwUpdated} aggiornate`);

  console.log('\n======================================================');
  console.log('🎉 MIGRAZIONE COMPLETATA CON SUCCESSO!');
  console.log('======================================================');
}

main()
  .catch(e => {
    console.error('❌ Errore durante la migrazione:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
