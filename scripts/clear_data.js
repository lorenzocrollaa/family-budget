const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function resetAll() {
  const email = 'demo@famiglia.it';
  const user = await prisma.user.findUnique({ where: { email } });
  
  if (!user) {
    console.log("Utente demo@famiglia.it non trovato. Assicurati che il database sia inizializzato.");
    process.exit(1);
  }

  const userId = user.id;

  try {
    console.log("🔥 Inizio reset completo del database per testare il nuovo categorizzatore...");

    // Elimina transazioni
    const { count: txCount } = await prisma.transaction.deleteMany({ where: { userId } });
    console.log(`- Eliminate ${txCount} transazioni.`);

    // Elimina cronologia di upload dei file
    const { count: fileCount } = await prisma.uploadedFile.deleteMany({ where: { userId } });
    console.log(`- Eliminati ${fileCount} file estratti conto storici.`);

    // Elimina dati di viaggio (che includono spese)
    const { count: travelCount } = await prisma.travel.deleteMany({ where: { userId } });
    console.log(`- Eliminati ${travelCount} viaggi storici.`);

    // Azzera la memoria e l'apprendimento automatico dell'AI e Keywords Apprese
    const { count: kwCount } = await prisma.categoryKeyword.deleteMany({ where: { userId } });
    console.log(`- Eliminate ${kwCount} keyword apprese.`);

    // Elimina Cache Esercenti
    const { count: cacheCount } = await prisma.merchantCache.deleteMany();
    console.log(`- Eliminate ${cacheCount} associazioni nella cache commercianti.`);

    // Azzera contatori delle Categorie
    const { count: catCount } = await prisma.category.updateMany({
      where: { userId },
      data: { 
        totalAmount: 0, 
        transactionCount: 0 
      }
    });
    console.log(`- Azzerate le statistiche di ${catCount} categorie.`);

    console.log("✅ RESET COMPLETATO! Il sistema è vergine e pronto per testare l'algoritmo Ibrido.");

  } catch (err) {
    console.error("Errore durante il reset:", err);
  } finally {
    await prisma.$disconnect();
  }
}

resetAll();
