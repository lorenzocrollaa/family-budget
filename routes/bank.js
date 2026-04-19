const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../middleware/auth');
const { requirePro } = require('../middleware/requirePro');
const plaidClient = require('../utils/plaidClient');
const { categorizeUltimate } = require('../utils/ultimateCategorizer');

const router = express.Router();
const prisma = new PrismaClient();

// Cooldown per prevenire hammer ripetuto sull'endpoint di sync.
// Chiave: connectionId, Valore: { lastAttempt: timestamp, isWaiting: bool }
const syncCooldowns = new Map();
const SYNC_COOLDOWN_MS = 5 * 60 * 1000; // 5 minuti

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST /api/bank/create-link-token
 * Genera un token temporaneo per inizializzare Plaid Link nel frontend.
 */
router.post('/create-link-token', authenticateToken, requirePro, async (req, res) => {
  try {
    const userId = req.user.id;
    const request = {
      user: {
        // Obbligatorio, deve essere l'ID utente interno
        client_user_id: userId,
      },
      client_name: 'Family Budget Tracker',
      products: ['transactions'],
      country_codes: process.env.PLAID_COUNTRY_CODES ? process.env.PLAID_COUNTRY_CODES.split(',') : ['IT'],
      language: 'it',
      link_customization_name: process.env.PLAID_LINK_CUSTOMIZATION_NAME || undefined,
      redirect_uri: process.env.PLAID_REDIRECT_URI || undefined,
      webhook: process.env.PLAID_WEBHOOK_URL || undefined,
      transactions: {
        days_requested: 90
      }
    };

    console.log('🔍 [Plaid] Creazione Link Token con parametri:', JSON.stringify(request, null, 2));

    const response = await plaidClient.linkTokenCreate(request);
    res.json({ success: true, link_token: response.data.link_token });
  } catch (error) {
    console.error('❌ Errore Plaid createLinkToken:', error.response ? error.response.data : error.message);
    res.status(500).json({ success: false, error: 'Errore generazione token di collegamento' });
  }
});

/**
 * POST /api/bank/create-update-link-token/:accountId
 * Genera un token per la Update Mode di Plaid, usato per riparare una connessione (MFA scaduta).
 */
router.post('/create-update-link-token/:accountId', authenticateToken, requirePro, async (req, res) => {
  const { accountId } = req.params;
  const userId = req.user.id;

  try {
    const dbAccount = await prisma.bankAccount.findUnique({
      where: { id: accountId },
      include: { connection: true }
    });

    if (!dbAccount || dbAccount.userId !== userId) {
      return res.status(404).json({ success: false, error: 'Conto non trovato' });
    }

    const request = {
      user: { client_user_id: userId },
      client_name: 'Family Budget Tracker',
      access_token: dbAccount.connection.accessToken,
      language: 'it',
      country_codes: process.env.PLAID_COUNTRY_CODES ? process.env.PLAID_COUNTRY_CODES.split(',') : ['IT'],
      redirect_uri: process.env.PLAID_REDIRECT_URI || undefined,
      // Nota: days_requested NON è supportato in update mode
    };
    
    if (process.env.PLAID_LINK_CUSTOMIZATION_NAME) {
      request.link_customization_name = process.env.PLAID_LINK_CUSTOMIZATION_NAME;
    }

    console.log(`🔄 [Plaid Update Mode] Creazione token riparazione per: ${dbAccount.name}`);
    
    const response = await plaidClient.linkTokenCreate(request);
    res.json({ success: true, link_token: response.data.link_token });

  } catch (error) {
    console.error('❌ Errore Plaid createUpdateLinkToken:', error.response ? error.response.data : error.message);
    res.status(500).json({ success: false, error: 'Impossibile generare il token di aggiornamento Plaid' });
  }
});


/**
 * POST /api/bank/exchange-public-token
 * Scambia il public_token generato dal frontend con un access_token permanente e salva la connessione.
 */
router.post('/exchange-public-token', authenticateToken, requirePro, async (req, res) => {
  const { public_token, institution_id, institution_name } = req.body;
  const userId = req.user.id;

  try {
    const exchangeResponse = await plaidClient.itemPublicTokenExchange({
      public_token: public_token,
    });

    const accessToken = exchangeResponse.data.access_token;
    const itemId = exchangeResponse.data.item_id;

    console.log(`🔗 [Plaid] Recupero metadati per banca: ${institution_id}`);
    
    // Recupera Info Banca (Logo, Colore, Nome Completo)
    let instName = institution_name || 'Banca Sconosciuta';
    let instLogo = null;
    let instColor = null;

    if (institution_id) {
      try {
        const instResponse = await plaidClient.institutionsGetById({
          institution_id: institution_id,
          country_codes: (process.env.PLAID_COUNTRY_CODES || 'IT,ES,DE,FR,GB').split(','),
          options: { include_optional_metadata: true }
        });
        const inst = instResponse.data.institution;
        instName = inst.name || instName;
        instLogo = inst.logo; // Base64
        instColor = inst.primary_color; // HEX
        console.log(`🏦 [Plaid] Metadati ricevuti per ${instName}: Logo=${!!instLogo}, Color=${instColor}`);
      } catch (err) {
        console.error('⚠️ [Plaid] Impossibile recuperare metadati banca:', err.message);
      }
    }

    console.log(`🔗 [Plaid] Connessione salvata per Item ${itemId}`);

    // Salva la connessione nel DB
    const connection = await prisma.bankConnection.create({
      data: {
        accessToken: accessToken,
        itemId: itemId,
        institutionId: institution_id || 'UNKNOWN',
        institutionName: instName,
        institutionLogo: instLogo,
        institutionColor: instColor,
        userId: userId,
        status: 'ACTIVE'
      }
    });

    // Recupera in tempo reale i conti assegnati a questo accessToken
    const accountsResponse = await plaidClient.accountsGet({
      access_token: accessToken,
    });

    const accounts = accountsResponse.data.accounts;

    for (const acc of accounts) {
      await prisma.bankAccount.create({
        data: {
          accountId: acc.account_id,
          userId: userId,
          connectionId: connection.id,
          name: acc.name,
          ownerName: acc.official_name || 'Intestatario Ignoto',
          balance: acc.balances.current,
          currency: acc.balances.iso_currency_code || 'EUR',
          isEnabled: true, // ✅ Ora i conti partono SUBITO attivi
          isConnected: true // ✅ E già connessi al budget
        }
      });
    }

    res.json({ success: true, message: 'Banca collegata con successo!' });
  } catch (error) {
    console.error('❌ Errore Plaid exchangePublicToken:', error.response ? error.response.data : error.message);
    res.status(500).json({ success: false, error: 'Errore nello scambio del token' });
  }
});

/**
 * GET /api/bank/accounts
 * Elenca i conti dell'utente
 */
router.get('/accounts', authenticateToken, requirePro, async (req, res) => {
  try {
    const accounts = await prisma.bankAccount.findMany({
      where: { userId: req.user.id },
      include: { connection: true }
    });
    res.json({ success: true, data: accounts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/bank/sync/:accountId
 * Sincronizza le transazioni per un conto o un'intera connessione usando l'API Sync di Plaid
 */
router.post('/sync/:accountId', authenticateToken, requirePro, async (req, res) => {
  const { accountId } = req.params;
  const userId = req.user.id;

  try {
    const dbAccount = await prisma.bankAccount.findUnique({
      where: { id: accountId },
      include: { connection: true }
    });


    if (!dbAccount) throw new Error('Conto non trovato');

    // ── COOLDOWN GUARD ───────────────────────────────────────────────────────
    // Previene hammer ripetuto che degrada l'Item Plaid a ITEM_LOGIN_REQUIRED.
    const connectionId = dbAccount.connection.id;
    const now = Date.now();
    const cd = syncCooldowns.get(connectionId);
    if (cd && cd.isWaiting && (now - cd.lastAttempt) < SYNC_COOLDOWN_MS) {
      const retryAfterSeconds = Math.ceil((SYNC_COOLDOWN_MS - (now - cd.lastAttempt)) / 1000);
      console.log(`⏳ [Cooldown] Sync bloccato: la banca sta ancora elaborando. Riprova tra ${retryAfterSeconds}s.`);
      return res.json({
        success: true,
        isWaiting: true,
        retryAfterSeconds,
        newCount: 0,
        message: `La banca sta ancora elaborando i dati. Riprova tra ${Math.ceil(retryAfterSeconds / 60)} minuti.`
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    console.log(`\n--- 📥 [AUDIT] INIZIO SINCRONIZZAZIONE PLAID ---`);
    console.log(`🏦 Conto DB: ${dbAccount.name}`);

    // ── PLAID TRANSACTIONS SYNC ───────────────────────────────────────────────
    // Usiamo SOLO transactionsSync (API moderna, raccomandata da Plaid).
    // - Prima chiamata (nessun cursor): recupera tutta la storia disponibile dalla banca.
    // - Chiamate successive (cursor presente): recupera solo i nuovi movimenti.
    // Vantaggi vs transactionsGet: gestisce automaticamente la finestra storica,
    // non richiede date esplicite, restituisce aggiornamenti/eliminazioni.
    let added = [];
    const existingCursor = dbAccount.connection.cursor || undefined;
    let nextCursor = existingCursor;
    let hasMore = true;
    let syncProductNotReady = false;

    console.log(`📌 transactionsSync — cursor: ${existingCursor ? 'esistente' : 'NESSUNO (prima sync)'}`);

    while (hasMore) {
      try {
        const syncResponse = await plaidClient.transactionsSync({
          access_token: dbAccount.connection.accessToken,
          count: 500, // max per richiesta
          ...(nextCursor ? { cursor: nextCursor } : {})
        });
        const data = syncResponse.data;
        console.log(`   📦 transactionsSync: +${data.added.length} aggiunte, has_more=${data.has_more}`);
        added = added.concat(data.added);
        hasMore = data.has_more;
        nextCursor = data.next_cursor;
      } catch (syncErr) {
        const errCode = syncErr.response?.data?.error_code;
        console.error(`   ❌ Errore transactionsSync [${errCode || syncErr.message}]`);

        if (errCode === 'PRODUCT_NOT_READY') {
          // La banca non ha ancora estratto i dati. NON salviamo il cursor
          // (così il prossimo sync riparte da zero e ritrova tutta la storia).
          syncProductNotReady = true;
        } else if (errCode === 'ITEM_LOGIN_REQUIRED' || errCode === 'INVALID_ACCESS_TOKEN') {
          // Questi errori devono raggiungere l'handler esterno per restituire requiresUpdate:true
          // e mostrare il pulsante "Risolvi Errore" nel frontend.
          throw syncErr;
        }
        hasMore = false;
      }
    }

    if (syncProductNotReady) {
      syncCooldowns.set(connectionId, { lastAttempt: Date.now(), isWaiting: true });
      console.log('   ⏳ [INFO] Plaid non ancora pronto. Cooldown attivo 5 minuti, cursor NON salvato.');
      return res.json({
        success: true,
        isWaiting: true,
        retryAfterSeconds: SYNC_COOLDOWN_MS / 1000,
        newCount: 0,
        message: 'La banca sta ancora elaborando i dati. Riprova tra 5 minuti — non premere di nuovo Sincronizza.'
      });
    }

    // Salva il cursor aggiornato solo se la sync ha avuto successo
    await prisma.bankConnection.update({
      where: { id: dbAccount.connection.id },
      data: { cursor: nextCursor }
    });

    // Diagnostica se 0 transazioni: distingue "Plaid ancora in elaborazione" da "conto vuoto"
    let zeroReason = null; // 'processing' | 'empty' | 'failed'
    if (added.length === 0) {
      try {
        const itemRes = await plaidClient.itemGet({ access_token: dbAccount.connection.accessToken });
        const txStatus = itemRes.data.item.status?.transactions;
        if (txStatus?.last_successful_update) {
          console.log(`   ✅ Ultimo pull riuscito: ${new Date(txStatus.last_successful_update).toLocaleString()} — 0 movimenti nel periodo.`);
          zeroReason = 'empty';
        } else if (txStatus?.last_failed_update) {
          console.log(`   ❌ Ultimo pull fallito: ${new Date(txStatus.last_failed_update).toLocaleString()}`);
          zeroReason = 'failed';
        } else {
          console.log(`   ⏳ Plaid sta ancora estraendo i dati dalla banca.`);
          zeroReason = 'processing';
        }
      } catch (_) {
        zeroReason = 'processing'; // Nessuno status = probabilmente ancora in elaborazione
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    console.log(`📊 Totale transazioni ricevute da Plaid: ${added.length}`);
    console.log(`🔍 Filtro per account_id: "${dbAccount.accountId}"`);

    const validAdded = added.filter(tx => tx.account_id === dbAccount.accountId);
    console.log(`✅ Transazioni valide dopo filtro account: ${validAdded.length}`);

    let newCount = 0;
    let totalIncome = 0;
    let totalExpense = 0;

    // Calcolo offset per spostare le transazioni Sandbox ad "oggi" mantenendo gli intervalli
    let sandboxOffsetMs = 0;
    if (process.env.PLAID_ENV === 'sandbox' && validAdded.length > 0) {
      const maxDate = Math.max(...validAdded.map(tx => new Date(tx.date || tx.authorized_date).getTime()));
      sandboxOffsetMs = Date.now() - maxDate;
    }

    // ── BATCH PROCESSING ─────────────────────────────────────────────────────
    // 1) Normalizza i dati Plaid
    const txPayloads = validAdded.map(bankTx => {
      const amount = -parseFloat(bankTx.amount);
      let date = new Date(bankTx.date || bankTx.authorized_date);
      if (process.env.PLAID_ENV === 'sandbox') date = new Date(date.getTime() + sandboxOffsetMs);
      if (amount > 0) totalIncome += amount;
      else totalExpense += Math.abs(amount);
      return {
        providerId: bankTx.transaction_id,
        description: bankTx.merchant_name || bankTx.name || 'Transazione Bancaria',
        originalText: bankTx.name,
        amount,
        date
      };
    });

    // 2) Categorizzazione in parallelo (tutti e N contemporaneamente)
    console.log(`   ⚙️  Categorizzazione batch di ${txPayloads.length} transazioni...`);
    const categorizations = await Promise.all(
      txPayloads.map(tx => categorizeUltimate({ description: tx.description, amount: tx.amount }, userId))
    );

    // 3) Upsert categorie uniche in un'unica transazione DB
    const uniqueCategories = [...new Set(categorizations.map(c => c.category || 'Altre Spese'))];
    await prisma.$transaction(
      uniqueCategories.map(name => prisma.category.upsert({
        where: { name_userId: { name, userId } },
        update: {},
        create: { name, userId, emoji: '💸', color: '#4facfe' }
      }))
    );

    // 4) Upsert transazioni in un'unica transazione DB
    await prisma.$transaction(
      txPayloads.map((tx, i) => {
        const categorization = categorizations[i];
        const categoryName = categorization.category || 'Altre Spese';
        return prisma.transaction.upsert({
          where: { providerTransactionId: tx.providerId },
          update: { date: tx.date, amount: tx.amount, description: categorization.displayName || tx.description },
          create: {
            date: tx.date,
            description: categorization.displayName || tx.description,
            amount: tx.amount,
            category: categoryName,
            categoryName,
            originalText: tx.originalText,
            confidence: categorization.confidence,
            categorizationReason: categorization.reason,
            isVerified: categorization.confidence > 0.9,
            userId,
            bankAccountId: dbAccount.id,
            providerTransactionId: tx.providerId
          }
        });
      })
    );

    newCount = txPayloads.length;
    // ─────────────────────────────────────────────────────────────────────────

    // Dopo sync riuscita, rimuovi il cooldown (se era in attesa)
    syncCooldowns.delete(connectionId);

    // Qui gestiremmo eventuali modified & removed (omesso per semplicità in questa fase)
    
    console.log('--- 📊 [AUDIT] RISULTATO SINCRO ---');
    console.log(`✅ Nuove transazioni salvate: ${newCount}`);
    console.log(`💰 Volume Entrate: +€${totalIncome.toFixed(2)}`);
    console.log(`💸 Volume Uscite: -€${totalExpense.toFixed(2)}`);
    console.log('--- 🏁 [AUDIT] FINE --- \n');

    // 1. Recupera il saldo aggiornato in tempo reale (Prodotto Balance)
    let latestBalance = dbAccount.balance;
    try {
      const balRes = await plaidClient.accountsBalanceGet({
        access_token: dbAccount.connection.accessToken
      });
      const matchedAccount = balRes.data.accounts.find(a => a.account_id === dbAccount.accountId) || balRes.data.accounts[0];
      if (matchedAccount) {
        latestBalance = matchedAccount.balances.current;
        console.log(`⚖️  Saldo aggiornato durante sync: €${latestBalance}`);
      }
    } catch (balErr) {
      const balErrCode = balErr.response?.data?.error_code || balErr.message;
      console.warn(`⚠️ Impossibile aggiornare il saldo: [${balErrCode}]`, balErr.response?.data?.error_message || '');
    }

    // 2. Aggiorna il conto con la data sync e il saldo (se recuperato)
    await prisma.bankAccount.update({
      where: { id: dbAccount.id },
      data: { 
        lastSync: new Date(),
        balance: latestBalance,
        isConnected: true // ✅ Ora contribuisce al budget globale
      }
    });



    // Messaggio finale contestuale
    let message;
    if (newCount > 0) {
      message = `Sincronizzazione completata! ${newCount} nuovi movimenti importati.`;
    } else if (zeroReason === 'processing') {
      message = 'BNL è connessa ✅ — Plaid sta ancora estraendo la cronologia dei movimenti dalla banca. Riprova tra 15-30 minuti cliccando "Aggiorna Saldo".';
    } else if (zeroReason === 'failed') {
      message = 'La banca ha avuto un problema temporaneo nel fornire i dati. Riprova più tardi.';
    } else {
      message = 'Nessun movimento nuovo nel periodo (ultimi 90 giorni).';
    }

    res.json({
      success: true,
      message,
      newCount,
      isProcessing: zeroReason === 'processing'
    });

  } catch (error) {
    const errorData = error.response ? error.response.data : {};
    console.error('❌ [Bank Sync] Errore critico:', errorData || error.message);
    
    // Se la banca richiede l'autenticazione a due fattori (MFA)
    if (errorData.error_code === 'ITEM_LOGIN_REQUIRED' || errorData.error_code === 'INVALID_ACCESS_TOKEN') {
      return res.status(403).json({
        success: false,
        error: errorData.error_code === 'ITEM_LOGIN_REQUIRED'
          ? 'La banca richiede una nuova autenticazione. Clicca "Risolvi Errore".'
          : 'Token di accesso non valido. Scollega e ricollega il conto.',
        requiresUpdate: true
      });
    }

    res.status(500).json({ success: false, error: 'Errore di Sincronizzazione Plaid' });
  }
});

/**
 * POST /api/bank/sandbox/fire-transactions/:connectionId
 * SOLO SANDBOX: Triggera la generazione di transazioni fittizie su Plaid.
 * In Sandbox le transazioni non arrivano automaticamente alla prima sync:
 * bisogna chiamare questa API per "seminare" i dati di test.
 */
router.post('/sandbox/fire-transactions/:connectionId', authenticateToken, requirePro, async (req, res) => {
  if (process.env.PLAID_ENV !== 'sandbox') {
    return res.status(403).json({ success: false, error: 'Endpoint disponibile solo in Sandbox' });
  }

  const { connectionId } = req.params;
  const userId = req.user.id;

  try {
    const connection = await prisma.bankConnection.findUnique({
      where: { id: connectionId }
    });

    if (!connection || connection.userId !== userId) {
      return res.status(404).json({ success: false, error: 'Connessione non trovata' });
    }

    // Triggera il webhook DEFAULT_UPDATE che fa comparire le transazioni
    await plaidClient.sandboxItemFireWebhook({
      access_token: connection.accessToken,
      webhook_code: 'DEFAULT_UPDATE'
    });

    console.log(`🔥 [Sandbox] Webhook DEFAULT_UPDATE inviato per item: ${connection.itemId}`);
    res.json({ success: true, message: 'Transazioni sandbox generate. Risinronizza tra un secondo!' });
  } catch (error) {
    console.error('❌ [Sandbox fire] Errore:', error.response ? JSON.stringify(error.response.data) : error.message);
    res.status(500).json({ success: false, error: error.response?.data?.error_message || error.message });
  }
});

/**
 * PATCH /api/bank/accounts/:id/toggle
 * Cambia la visibilità (isEnabled) di un conto specifico
 */
router.patch('/accounts/:id/toggle', authenticateToken, requirePro, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const account = await prisma.bankAccount.findUnique({
      where: { id: id },
    });

    if (!account || account.userId !== userId) {
      return res.status(404).json({ success: false, error: 'Conto non trovato' });
    }

    const updatedAccount = await prisma.bankAccount.update({
      where: { id: id },
      data: { 
        isEnabled: !account.isEnabled,
        // ✅ Se chiudo l'occhio, lo considero anche disconnesso/non-sincronizzato
        isConnected: !account.isEnabled ? account.isConnected : false 
      }
    });

    res.json({ 
      success: true, 
      isEnabled: updatedAccount.isEnabled,
      message: updatedAccount.isEnabled ? 'Conto attivato' : 'Conto nascosto dal budget'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/bank/connections/:id
 * Scollega definitivamente la banca
 */
router.delete('/connections/:id', authenticateToken, requirePro, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const connection = await prisma.bankConnection.findUnique({
      where: { id: id },
    });

    if (!connection || connection.userId !== userId) {
      return res.status(404).json({ success: false, error: 'Connessione non trovata' });
    }

    // Revoca il token su Plaid
    if (connection.accessToken) {
      try {
        await plaidClient.itemRemove({ access_token: connection.accessToken });
      } catch (err) {
        console.warn('⚠️ Errore Plaid itemRemove (procedo localmente):', err.message);
      }
    }

    // Prisma gestisce la cascata (Cascade)
    await prisma.bankConnection.delete({
      where: { id: id }
    });

    res.json({ success: true, message: 'Banca scollegata con successo.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/bank/balance/:accountId
 * Recupera solo il saldo in tempo reale dal prodotto Balance di Plaid
 */
router.post('/balance/:accountId', authenticateToken, requirePro, async (req, res) => {
  const { accountId } = req.params;
  const userId = req.user.id;

  try {
    const dbAccount = await prisma.bankAccount.findUnique({
      where: { id: accountId },
      include: { connection: true }
    });

    if (!dbAccount || dbAccount.userId !== userId) {
      return res.status(404).json({ success: false, error: 'Conto non trovato' });
    }

    console.log(`⚖️ [Plaid] Richiesta saldo in tempo reale per: ${dbAccount.name}`);

    // Chiamata all'API Balance di Plaid
    const balanceResponse = await plaidClient.accountsBalanceGet({
      access_token: dbAccount.connection.accessToken,
      options: {
        account_ids: [dbAccount.accountId]
      }
    });

    const plaidAccount = balanceResponse.data.accounts[0];
    if (!plaidAccount) throw new Error('Conto non restituito da Plaid');

    const newBalance = plaidAccount.balances.current;

    // Aggiorna il DB
    const updatedAccount = await prisma.bankAccount.update({
      where: { id: accountId },
      data: { 
        balance: newBalance,
        lastSync: new Date()
      }
    });

    res.json({ 
      success: true, 
      balance: newBalance,
      message: `Saldo aggiornato: € ${newBalance.toFixed(2)}`
    });

  } catch (error) {
    console.error('❌ [Plaid Balance] Errore:', error.response ? error.response.data : error.message);
    res.status(500).json({ success: false, error: 'Impossibile recuperare il saldo in tempo reale' });
  }
});

/**
 * POST /api/bank/webhook
 * Riceve notifiche asincrone da Plaid (SYNC_UPDATES_AVAILABLE, ITEM_LOGIN_REQUIRED, ecc.)
 * Questo endpoint deve essere pubblicamente raggiungibile (usare ngrok in locale).
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  // Rispondi subito 200 a Plaid (evita retry)
  res.sendStatus(200);

  let body;
  try {
    body = JSON.parse(req.body.toString());
  } catch {
    console.error('❌ [Webhook] Body non valido');
    return;
  }

  const { webhook_type, webhook_code, item_id, error } = body;
  console.log(`\n🔔 [Webhook] ${webhook_type}/${webhook_code} — item_id: ${item_id}`);

  try {
    // Trova la connessione associata all'item_id
    const connection = await prisma.bankConnection.findFirst({
      where: { itemId: item_id },
      include: { accounts: { where: { isEnabled: true } } }
    });

    if (!connection) {
      console.warn(`⚠️ [Webhook] Nessuna connessione trovata per item_id: ${item_id}`);
      return;
    }

    if (webhook_type === 'TRANSACTIONS' && webhook_code === 'SYNC_UPDATES_AVAILABLE') {
      // Plaid ha nuovi dati — triggera sync per ogni conto abilitato
      console.log(`✅ [Webhook] Nuovi dati disponibili per ${connection.institutionName} — avvio sync...`);
      for (const account of connection.accounts) {
        // Resetta il cooldown così la sync parte immediatamente
        syncCooldowns.delete(connection.id);
        await triggerSync(account.id, account.userId);
      }
    } else if (webhook_type === 'ITEM' && webhook_code === 'ERROR' && error?.error_code === 'ITEM_LOGIN_REQUIRED') {
      console.log(`⚠️ [Webhook] ITEM_LOGIN_REQUIRED per ${connection.institutionName} — aggiorno status DB`);
      await prisma.bankAccount.updateMany({
        where: { connectionId: connection.id },
        data: { isConnected: false }
      });
    } else if (webhook_type === 'ITEM' && webhook_code === 'PENDING_EXPIRATION') {
      console.log(`⏰ [Webhook] Sessione in scadenza per ${connection.institutionName}`);
    }
  } catch (err) {
    console.error('❌ [Webhook] Errore processing:', err.message);
  }
});

// Sync interno richiamato dal webhook (senza req/res)
async function triggerSync(bankAccountId, userId) {
  try {
    const dbAccount = await prisma.bankAccount.findUnique({
      where: { id: bankAccountId },
      include: { connection: true }
    });
    if (!dbAccount) return;

    let added = [];
    let hasMore = true;
    let nextCursor = dbAccount.connection.cursor || undefined;

    while (hasMore) {
      try {
        const syncResponse = await plaidClient.transactionsSync({
          access_token: dbAccount.connection.accessToken,
          count: 500,
          ...(nextCursor ? { cursor: nextCursor } : {})
        });
        const data = syncResponse.data;
        console.log(`   📦 [Webhook Sync] +${data.added.length} transazioni, has_more=${data.has_more}`);
        added = added.concat(data.added);
        hasMore = data.has_more;
        nextCursor = data.next_cursor;
      } catch (syncErr) {
        const errCode = syncErr.response?.data?.error_code;
        console.error(`   ❌ [Webhook Sync] ${errCode || syncErr.message}`);
        if (errCode === 'ITEM_LOGIN_REQUIRED' || errCode === 'INVALID_ACCESS_TOKEN') {
          await prisma.bankAccount.update({ where: { id: bankAccountId }, data: { isConnected: false } });
        }
        hasMore = false;
      }
    }

    // Salva cursor
    await prisma.bankConnection.update({
      where: { id: dbAccount.connection.id },
      data: { cursor: nextCursor }
    });

    const validAdded = added.filter(tx => tx.account_id === dbAccount.accountId);
    if (validAdded.length === 0) {
      console.log(`   ℹ️ [Webhook Sync] 0 nuove transazioni valide.`);
      return;
    }

    const txPayloads = validAdded.map(bankTx => ({
      providerId: bankTx.transaction_id,
      description: bankTx.merchant_name || bankTx.name || 'Transazione Bancaria',
      originalText: bankTx.name,
      amount: -parseFloat(bankTx.amount),
      date: new Date(bankTx.date || bankTx.authorized_date)
    }));

    const categorizations = await Promise.all(
      txPayloads.map(tx => categorizeUltimate({ description: tx.description, amount: tx.amount }, userId))
    );

    const uniqueCategories = [...new Set(categorizations.map(c => c.category || 'Altre Spese'))];
    await prisma.$transaction(
      uniqueCategories.map(name => prisma.category.upsert({
        where: { name_userId: { name, userId } },
        update: {},
        create: { name, userId, emoji: '💸', color: '#4facfe' }
      }))
    );

    let newCount = 0;
    await prisma.$transaction(
      txPayloads.map((tx, i) => {
        const categoryName = categorizations[i].category || 'Altre Spese';
        newCount++;
        return prisma.transaction.upsert({
          where: { providerId: tx.providerId },
          update: { description: tx.description, amount: tx.amount, date: tx.date },
          create: {
            providerId: tx.providerId,
            description: tx.description,
            originalText: tx.originalText,
            amount: tx.amount,
            date: tx.date,
            source: 'bank',
            bankAccountId,
            userId,
            categoryId: null
          }
        });
      })
    );

    await prisma.bankAccount.update({
      where: { id: bankAccountId },
      data: { lastSync: new Date(), isConnected: true }
    });

    console.log(`✅ [Webhook Sync] ${newCount} nuove transazioni salvate per account ${bankAccountId}`);
  } catch (err) {
    console.error('❌ [Webhook triggerSync] Errore:', err.message);
  }
}

module.exports = router;
