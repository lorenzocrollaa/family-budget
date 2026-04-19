require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const plaidClient = require('./utils/plaidClient');

const prisma = new PrismaClient();

async function testPlaid() {
  try {
    const connection = await prisma.bankConnection.findFirst({
      orderBy: { createdAt: 'desc' },
      include: { accounts: true }
    });

    if (!connection) {
        console.log("❌ Nessuna connessione trovata nel DB.");
        return;
    }

    console.log("--- 🕵️ DIAGNOSTICA CONNESSIONE ---");
    console.log("ID Connessione:", connection.id);
    console.log("Banca:", connection.institutionName);
    console.log("Token:", connection.accessToken.substring(0, 15) + "...");
    console.log("Cursore Salvato:", connection.cursor || "NESSUNO");
    console.log("Account nel DB:", connection.accounts.length);
    connection.accounts.forEach(a => console.log(`  - ${a.name} (${a.accountId}) - Saldo: ${a.balance} ${a.currency}`));

    console.log("\n--- 1. TEST ACCOUNTS/GET ---");
    const accsRes = await plaidClient.accountsGet({ access_token: connection.accessToken });
    console.log("Account visti da Plaid ora:", accsRes.data.accounts.length);
    accsRes.data.accounts.forEach(a => {
        console.log(`  🔗 [${a.account_id}] ${a.name} (${a.subtype})`);
    });

    console.log("\n--- 2. TEST TRANSACTIONS/SYNC (CON CURSORE) ---");
    try {
        const syncWithCursor = await plaidClient.transactionsSync({
            access_token: connection.accessToken,
            cursor: connection.cursor || undefined
        });
        console.log(`  ✅ Sync con cursore: added=${syncWithCursor.data.added.length}, has_more=${syncWithCursor.data.has_more}`);
    } catch (e) {
        console.log("  ❌ Errore Sync con cursore:", e.response ? e.response.data.error_code : e.message);
    }

    console.log("\n--- 3. TEST TRANSACTIONS/SYNC (SENZA CURSORE - FULL PULL) ---");
    try {
        const syncWithoutCursor = await plaidClient.transactionsSync({
            access_token: connection.accessToken,
            count: 50 // Solo i primi 50 per test
        });
        console.log(`  ✅ Sync senza cursore: added=${syncWithoutCursor.data.added.length}, has_more=${syncWithoutCursor.data.has_more}`);
        if(syncWithoutCursor.data.added.length > 0) {
            console.log("  👀 Prime 3 transazioni trovate:");
            syncWithoutCursor.data.added.slice(0, 3).forEach(t => console.group(`    - ${t.date}: ${t.name} (${t.amount} ${t.iso_currency_code})`));
        }
    } catch (e) {
        console.log("  ❌ Errore Sync senza cursore:", e.response ? e.response.data.error_code : e.message);
    }

    console.log("\n--- 4. TEST TRANSACTIONS/GET (METODO CLASSICO - ULTIMI 2 ANNI) ---");
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 2);
    const startDateStr = startDate.toISOString().split('T')[0];

    try {
        const getRes = await plaidClient.transactionsGet({
            access_token: connection.accessToken,
            start_date: startDateStr,
            end_date: endDate,
            options: { count: 10 }
        });
        console.log(`  ✅ TransactionsGet: total=${getRes.data.total_transactions}, returned=${getRes.data.transactions.length}`);
    } catch (e) {
        console.log("  ❌ Errore TransactionsGet:", e.response ? e.response.data.error_code : e.message);
    }

    console.log("\n--- FINE DIAGNOSTICA ---");

  } catch (err) {
    console.error("❌ Errore fatale nello script:", err);
  } finally {
    await prisma.$disconnect();
  }
}

testPlaid();
