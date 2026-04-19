const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function normalizeCache() {
  console.log('🏁 Inizio normalizzazione MerchantCache per uppercase...');
  
  try {
    const entries = await prisma.merchantCache.findMany();
    console.log(`🔍 Analizzando ${entries.length} voci esistenti...`);

    let count = 0;
    for (const entry of entries) {
      const upperName = entry.merchantName.toUpperCase();
      
      if (entry.merchantName !== upperName) {
        // Controlla se esiste già la versione maiuscola
        const duplicate = await prisma.merchantCache.findUnique({
          where: { merchantName: upperName }
        });

        if (duplicate) {
          // Se esiste già, eliminiamo il record "sporco" (quello minuscolo/misto)
          // e manteniamo quello maiuscolo. (Pulizia duplicati)
          await prisma.merchantCache.delete({ where: { id: entry.id } });
        } else {
          // Altrimenti aggiorniamo semplicemente il nome in maiuscolo
          await prisma.merchantCache.update({
            where: { id: entry.id },
            data: { merchantName: upperName }
          });
        }
        count++;
      }
    }
    console.log(`✅ Successo! ${count} voci normalizzate.`);
  } catch (err) {
    console.error('❌ Errore durante la normalizzazione:', err.message);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

normalizeCache();
