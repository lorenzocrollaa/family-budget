// routes/transactions.js - CON LEARNING AUTOMATICO ATTIVATO + BUG FIX

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../middleware/auth');
const { parseFile } = require('../utils/fileParser');

// 🎯 USA IL CATEGORIZER UNIFICATO (Local-First + Smart Transfer Logic)
const { categorizeBatchUltimate, categorizeUltimate, extractKeywords } = require('../utils/ultimateCategorizer');
const { getMetadata } = require('../utils/categoryMetadata');

const router = express.Router();
const prisma = new PrismaClient();

// Configurazione multer per upload file
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/statements';
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: function (req, file, cb) {
    const allowedTypes = [
      'application/pdf',
      'text/csv',
      'text/plain',
      'application/json',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    
    const allowedExtensions = ['.pdf', '.csv', '.txt', '.json', '.qif', '.ofx', '.qfx', '.mt940', '.sta', '.xlsx', '.xls'];
    const fileExtension = path.extname(file.originalname).toLowerCase();
    
    if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(fileExtension)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo di file non supportato. Usa: PDF, CSV, TXT, JSON, QIF, OFX, MT940'));
    }
  }
});

/**
 * 🛠️ UTILS: Costruisce il filtro WHERE in modo consistente tra le varie rotte
 */
async function buildTransactionWhere(req) {
  const { 
    dateFrom, 
    dateTo, 
    category, 
    minAmount, 
    maxAmount,
    search,
    needsReview,
    uploadedFileId
  } = req.query;

  // Trova l'utente corretto per email (dal token)
  // Usa l'ID utente dal token (affidabile)
  const userId = req.user.id;
  
  if (!userId) {
    throw new Error('User ID non trovato nel token');
  }

  const where = {
    userId: userId
  };

  // Integrità File ID
  if (uploadedFileId && uploadedFileId !== 'null' && uploadedFileId !== 'undefined') {
    where.uploadedFileId = uploadedFileId;
  }

  // Integrità Bank Account ID
  const { bankAccountId } = req.query;
  if (bankAccountId && bankAccountId !== 'null' && bankAccountId !== 'undefined') {
    where.bankAccountId = bankAccountId;
  }

  // Integrità Date
  if ((dateFrom && dateFrom !== 'null' && dateFrom !== 'undefined') || 
      (dateTo && dateTo !== 'null' && dateTo !== 'undefined')) {
    where.date = {};
    if (dateFrom && dateFrom !== 'null' && dateFrom !== 'undefined') {
      const fromDate = new Date(dateFrom);
      if (!isNaN(fromDate.getTime())) {
        fromDate.setHours(0,0,0,0);
        // ✅ Molto generoso (48 ore) per evitare tagli dovuti a fuso orario quando si guarda un file
        const marginHours = (uploadedFileId && uploadedFileId !== 'null') ? 48 : 12;
        const marginDate = new Date(fromDate.getTime() - (marginHours * 60 * 60 * 1000));
        where.date.gte = marginDate;
      }
    }
    if (dateTo && dateTo !== 'null' && dateTo !== 'undefined') {
      const toDate = new Date(dateTo);
      if (!isNaN(toDate.getTime())) {
        toDate.setHours(23,59,59,999);
        // ✅ Molto generoso (48 ore)
        const marginHours = (uploadedFileId && uploadedFileId !== 'null') ? 48 : 12;
        const marginDate = new Date(toDate.getTime() + (marginHours * 60 * 60 * 1000));
        where.date.lte = marginDate;
      }
    }
  }

  // ✅ ESCLUDI TRANSAZIONI DI MEMORIA (DATABASE AI) PER DEFAULT
  // Si mostrano solo se esplicitamente richiesto (es. tab DB Admin)
  // MANTENIAMO VISIBILI I RISULTATI se si sta guardando uno specifico file appena caricato
  const { includeMemory } = req.query;
  const isViewingSpecificFile = uploadedFileId && uploadedFileId !== 'null' && uploadedFileId !== 'undefined';
  
  if (includeMemory !== 'true' && !isViewingSpecificFile) {
    where.isMemory = false;
  }

  // Categoria
  if (category && category !== 'null' && category !== 'undefined') {
    where.category = category;
  }

  // ✅ FILTRO AUTO-ESCLUSIONE CONTI DISABILITATI (Global View)
  // Se non stiamo guardando un file specifico e non stiamo guardando un conto specifico,
  // ✅ FILTRO PIAZZA PULITA (Banche vs PDF)
  const { showAll } = req.query;

  if (uploadedFileId) {
    // Modalità File Specifico (PDF)
    where.uploadedFileId = uploadedFileId;
    where.bankAccountId = null;
  } else if (bankAccountId) {
    // Modalità Conto Bancario Specifico
    if (!where.AND) where.AND = [];
    where.AND.push({ bankAccount: { isEnabled: true, isConnected: true } });
    where.bankAccountId = bankAccountId;
  } else if (showAll !== 'true') {
    // Modalità Bancaria (Home web) — solo conti connessi
    if (!where.AND) where.AND = [];
    where.AND.push({ bankAccount: { isEnabled: true, isConnected: true } });
    where.bankAccountId = { not: null };

    const hasExplicitDateFilter = (dateFrom && dateFrom !== 'null' && dateFrom !== 'undefined') ||
                                  (dateTo && dateTo !== 'null' && dateTo !== 'undefined');
    if (!hasExplicitDateFilter) {
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      ninetyDaysAgo.setHours(0, 0, 0, 0);
      where.date = { gte: ninetyDaysAgo };
    }
  }
  // showAll=true → nessun filtro aggiuntivo, mostra tutto

  // Importi
  if (minAmount || maxAmount) {
    where.amount = {};
    if (minAmount && !isNaN(parseFloat(minAmount))) where.amount.gte = parseFloat(minAmount);
    if (maxAmount && !isNaN(parseFloat(maxAmount))) where.amount.lte = parseFloat(maxAmount);
  }

  // Ricerca testuale
  if (search && search !== 'null' && search !== 'undefined') {
    where.description = {
      contains: search,
      mode: 'insensitive'
    };
  }

  // Revisione necessaria (Al nel 80% confidence)
  if (needsReview === 'true') {
    where.isVerified = false;
    where.confidence = { lt: 0.8 };
  }

  console.log('🔍 [buildTransactionWhere] Input:', { userId, uploadedFileId, dateFrom, dateTo, category });
  console.log('🔍 [buildTransactionWhere] Final WHERE:', JSON.stringify(where, null, 2));

  return { where, userId };
}

// GET /api/transactions - Lista transazioni con filtri e paginazione
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 100 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const { where, userId } = await buildTransactionWhere(req);

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy: { date: 'desc' },
        skip,
        take: parseInt(limit),
        include: {
          uploadedFile: {
            select: { originalName: true }
          }
        }
      }),
      prisma.transaction.count({ where })
    ]);

    const totalPages = Math.ceil(total / parseInt(limit));

    res.json({
      success: true,
      data: {
        transactions: transactions.map(t => ({
          id: t.id,
          date: t.date.toISOString().split('T')[0],
          description: t.description,
          amount: parseFloat(t.amount),
          category: t.category,
          isVerified: t.isVerified,
          confidence: t.confidence,
          sourceFile: t.uploadedFile?.originalName
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      }
    });

  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({
      success: false,
      error: 'Errore nel recupero delle transazioni'
    });
  }
});

// GET /api/transactions/monthly-breakdown - Analisi mensile per categoria
router.get('/monthly-breakdown', authenticateToken, async (req, res) => {
  try {
    const { where } = await buildTransactionWhere(req);

    const transactions = await prisma.transaction.findMany({
      where,
      select: { date: true, amount: true, category: true },
      orderBy: { date: 'asc' }
    });

    // Group by YYYY-MM, then by category
    const monthMap = {};
    for (const tx of transactions) {
      const month = tx.date.toISOString().slice(0, 7); // "2025-11"
      if (!monthMap[month]) monthMap[month] = { income: 0, expenses: 0, categories: {} };

      const amount = parseFloat(tx.amount);
      if (amount > 0) {
        monthMap[month].income += amount;
      } else {
        monthMap[month].expenses += Math.abs(amount);
        const cat = tx.category || 'Altre Spese';
        monthMap[month].categories[cat] = (monthMap[month].categories[cat] || 0) + Math.abs(amount);
      }
    }

    // Convert to sorted array
    const months = Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({
        month,
        income: Math.round(data.income * 100) / 100,
        expenses: Math.round(data.expenses * 100) / 100,
        balance: Math.round((data.income - data.expenses) * 100) / 100,
        categories: Object.entries(data.categories)
          .sort(([, a], [, b]) => b - a)
          .map(([name, amount]) => ({ 
            name, 
            amount: Math.round(amount * 100) / 100,
            color: getMetadata(name).color,
            emoji: getMetadata(name).emoji
          }))
      }));

    res.json({ success: true, data: { months } });
  } catch (error) {
    console.error('Error monthly-breakdown:', error);
    res.status(500).json({ success: false, error: 'Errore nel calcolo mensile' });
  }
});

// GET /api/transactions/stats - Statistiche periodo
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const { where, userId } = await buildTransactionWhere(req);

    // 🩹 SELF-HEALING: Correggi al volo eventuali bonifici in entrata mal categorizzati come "Bonifico"
    // Questo sistema corregge i dati storici senza bisogno di script esterni o re-upload.
    const misCategorizedCount = await prisma.transaction.count({
      where: { ...where, category: 'Bonifico', amount: { gt: 0 } }
    });

    if (misCategorizedCount > 0) {
      console.log(`🩹 Self-healing: Fixing ${misCategorizedCount} mis-categorized income transfers...`);
      await prisma.transaction.updateMany({
        where: { ...where, category: 'Bonifico', amount: { gt: 0 } },
        data: { 
          category: 'Entrate Varie',
          confidence: 0.99,
          categorizationReason: 'Self-healing: Income transferred from Bonifico to Entrate Varie'
        }
      });
      // Forza ricalcolo stats se abbiamo modificato qualcosa
      await updateCategoryStats(userId);
    }

    console.log('📊 Stats query where:', JSON.stringify(where, null, 2));

    const [totalStats, categoryStats] = await Promise.all([
      prisma.transaction.aggregate({
        where,
        _sum: { amount: true },
        _count: true
      }),
      
      prisma.transaction.groupBy({
        by: ['category'],
        where,
        _sum: { amount: true },
        _count: true,
        orderBy: { _sum: { amount: 'desc' } }
      })
    ]);

    console.log(`📊 [stats] Found \${totalStats._count} transactions and \${categoryStats.length} categories matching filters.`);

    const income = parseFloat(
      await prisma.transaction.aggregate({
        where: { ...where, amount: { gt: 0 } },
        _sum: { amount: true }
      }).then(result => result._sum.amount?.toString() || "0")
    );

    const expenses = Math.abs(parseFloat(
      await prisma.transaction.aggregate({
        where: { ...where, amount: { lt: 0 } },
        _sum: { amount: true }
      }).then(result => result._sum.amount?.toString() || "0")
    ));

    // ✅ CALCOLO SALDO REALE (Assets) - Solo per conti abilitati E connessi
    // Questo è il numero che appare nel cerchio grande della Home
    const enabledAccounts = await prisma.bankAccount.findMany({
      where: { userId, isEnabled: true, isConnected: true },
      select: { balance: true }
    });
    const totalBankBalance = enabledAccounts.reduce((sum, acc) => sum + parseFloat(acc.balance || 0), 0);

    console.log('✅ Stats calculated:', { 
      total: totalStats._count, 
      income, 
      expenses,
      totalBankBalance,
      categories: categoryStats.length 
    });

    res.json({
      success: true,
      data: {
        summary: {
          totalTransactions: totalStats._count,
          totalAmount: parseFloat(totalStats._sum.amount?.toString() || "0"),
          income: income,
          expenses: expenses,
          balance: income - expenses, // 🔙 Ripristinato: Risparmio/Spesa del periodo
          totalBankBalance: totalBankBalance, // Mantieni il saldo reale come dato aggiuntivo
          periodDelta: income - expenses
        },
        byCategory: categoryStats.map(cat => ({
          category: cat.category,
          amount: Math.abs(parseFloat(cat._sum.amount)),
          count: cat._count,
          color: getMetadata(cat.category).color,
          emoji: getMetadata(cat.category).emoji,
          isIncome: parseFloat(cat._sum.amount) > 0
        })),
        byMonth: []
      }
    });

  } catch (error) {
    console.error('Error calculating stats:', error);
    res.status(500).json({
      success: false,
      error: 'Errore nel calcolo delle statistiche'
    });
  }
});

// POST /api/transactions/upload - Upload estratti conto
router.post('/upload', authenticateToken, upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Nessun file caricato'
      });
    }

    const userId = req.user.id;
    const results = [];
    let totalTransactions = 0;

    for (const file of req.files) {
      console.log(`Processing file: ${file.originalname}`);
      
      try {
        const uploadedFile = await prisma.uploadedFile.create({
          data: {
            originalName: file.originalname,
            fileName: file.filename,
            filePath: file.path,
            fileSize: file.size,
            mimeType: file.mimetype,
            userId: userId
          }
        });

        const parseResult = await parseFile(file.path, file.originalname, file.mimetype);
        
        console.log('Ã°Å¸â€œâ€ž Parse result:', { 
          success: parseResult.success, 
          transactionCount: parseResult.transactions?.length || 0,
          method: parseResult.method,
          error: parseResult.error 
        });
        
        if (parseResult.success && parseResult.transactions.length > 0) {
          console.log('Ã°Å¸â€Â First transaction sample:', parseResult.transactions[0]);
          
          let categorizedTransactions;
          try {
            // 🎯 USA IL CATEGORIZER UNIFICATO
            categorizedTransactions = await categorizeBatchUltimate(
              parseResult.transactions, 
              userId
            );
            console.log('Ã°Å¸Â¤â€“ Categorized transactions:', categorizedTransactions.length);
            console.log('Ã°Å¸â€Â First categorized sample:', categorizedTransactions[0]);
          } catch (catError) {
            console.error('Ã¢ÂÅ’ Categorization error:', catError);
            categorizedTransactions = parseResult.transactions.map(trans => ({
              ...trans,
              category: trans.amount > 0 ? 'Entrate Varie' : 'Altre Spese',
              confidence: 0.5
            }));
            console.log('Ã¢Å¡Â Ã¯Â¸Â Using default categories for', categorizedTransactions.length, 'transactions');
          }

          if (!categorizedTransactions || categorizedTransactions.length === 0) {
            console.error('Ã¢ÂÅ’ No transactions after categorization!');
            throw new Error('Nessuna transazione dopo categorizzazione');
          }

          try {
            const rawTransactionData = categorizedTransactions.map(trans => ({
              date: new Date(trans.date),
              description: trans.description || 'Nessuna descrizione',
              amount: parseFloat(trans.amount),
              category: trans.category || 'Altre Spese',
              confidence: trans.confidence || 0.5,
              originalText: trans.originalText || null,
              categorizationReason: trans.categorizationReason || null,
              userId: userId,
              uploadedFileId: uploadedFile.id,
              isMemory: req.body.isMemory === 'true' // ✅ Determinato dal checkbox in UI
            }));
      console.log('📦 Preparing to save', rawTransactionData.length, 'transactions');
            if (rawTransactionData.length > 0) {
                console.log('🔍 Sample data to save:', rawTransactionData[0]);
            }

            // --- INIZIO DEDUPLICAZIONE ---
            let transactionData = [];
            let duplicatesToUpdate = [];
            const existingTxMap = new Map();

            const getTxHash = (date, amount, desc, originalText = '', occurrenceIndex = 0) => {
              const d = new Date(date).toISOString().split('T')[0];
              // 🎯 FIX DEDUP: Usa il valore ASSOLUTO per l'importo nel hash.
              // In questo modo, se il parser corregge il segno (es: da +15 a -15), 
              // il backend riconosce che è la STESSA transazione e la AGGIORNA invece di duplicarla.
              const amt = Math.abs(parseFloat(amount)).toFixed(2);
              const text = (desc || '').trim().toLowerCase();
              const raw = (originalText || '').trim();
              // ✅ Aggiungi index per distinguere acquisti identici nello stesso giorno (es: 2 caffè da 1€)
              return `${d}_${amt}_${text}_${raw}_${occurrenceIndex}`;
            };
            
            if (rawTransactionData.length > 0) {
              const dateRangeIds = rawTransactionData.map(t => t.date.getTime());
              const minDate = new Date(Math.min(...dateRangeIds));
              const maxDate = new Date(Math.max(...dateRangeIds));
              
              // 🔥 FIX: Forza un dateRange perfetto calcolato direttamente dalle transazioni
              const minStr = minDate.toISOString().split('T')[0];
              const maxStr = maxDate.toISOString().split('T')[0];
              parseResult.dateRange = `${minStr} to ${maxStr}`;
              
              const existingTransactions = await prisma.transaction.findMany({
                where: {
                  userId: userId,
                  date: { gte: minDate, lte: maxDate }
                },
                select: { id: true, date: true, amount: true, description: true, originalText: true }
              });
              
              const dbOccurrences = new Map();
              existingTransactions.forEach(t => {
                const baseHash = getTxHash(t.date, t.amount, t.description, t.originalText, 0);
                const count = (dbOccurrences.get(baseHash) || 0) + 1;
                dbOccurrences.set(baseHash, count);
                
                const indexedHash = getTxHash(t.date, t.amount, t.description, t.originalText, count);
                existingTxMap.set(indexedHash, t.id);
              });
              
              // ✅ Mappa locale per contare occorrenze nel file corrente ed evitare "collisioni" interne
              const currentFileUploadOccurrences = new Map();

              rawTransactionData.forEach(t => {
                const baseHash = getTxHash(t.date, t.amount, t.description, t.originalText, 0);
                const count = (currentFileUploadOccurrences.get(baseHash) || 0) + 1;
                currentFileUploadOccurrences.set(baseHash, count);
                
                const indexedHash = getTxHash(t.date, t.amount, t.description, t.originalText, count);
                
                if (existingTxMap.has(indexedHash)) {
                  duplicatesToUpdate.push(existingTxMap.get(indexedHash));
                } else {
                  transactionData.push(t);
                }
              });
              
              console.log(`🔍 Trovate ${rawTransactionData.length} transazioni nel file. Duplicati ri-assegnati: ${duplicatesToUpdate.length}. Nuove da salvare: ${transactionData.length}`);
            }
            // --- FINE DEDUPLICAZIONE ---

            if (transactionData.length > 0) {
              const savedTransactions = await prisma.transaction.createMany({
                data: transactionData,
                skipDuplicates: true
              });
              console.log('💾 Saved to database:', savedTransactions.count, 'transactions');
            }
            
            // 🔥 FIX: Aggiorna ANCHE la categoria per i duplicati se non sono verificati
            if (duplicatesToUpdate.length > 0) {
              console.log(`♻️ Processing ${duplicatesToUpdate.length} duplicates for update...`);
              
              // Eseguiamo aggiornamenti individuali (o raggruppati per categoria) per preservare le nuove categorie dell'AI
              // Reset occorrenze per il loop di update
              const updateFileUploadOccurrences = new Map();
              for (const trans of rawTransactionData) {
                const baseHash = getTxHash(trans.date, trans.amount, trans.description, trans.originalText, 0);
                const count = (updateFileUploadOccurrences.get(baseHash) || 0) + 1;
                updateFileUploadOccurrences.set(baseHash, count);
                
                const indexedHash = getTxHash(trans.date, trans.amount, trans.description, trans.originalText, count);
                
                if (existingTxMap.has(indexedHash)) {
                  const existingId = existingTxMap.get(indexedHash);
                  
                  await prisma.transaction.update({
                    where: { id: existingId, isVerified: false }, // Aggiorna solo se l'utente non l'ha già validata
                    data: { 
                      uploadedFileId: uploadedFile.id,
                      amount: trans.amount, // ✅ AGGIORNA IL SEGNO SE CORRETTO DAL PARSER
                      category: trans.category,
                      confidence: trans.confidence,
                      isMemory: trans.isMemory, // Mantiene l'intenzione dell'utente (Memoria vs Dashboard)
                      categorizationReason: `AI Refreshed/Corrected sign during upload: ${trans.amount}`
                    }
                  }).catch(() => {
                    // Fallback se la transazione è verificata (aggiorna solo il fileId)
                    return prisma.transaction.update({
                      where: { id: existingId },
                      data: { 
                        uploadedFileId: uploadedFile.id,
                        isMemory: trans.isMemory // Mantiene l'intenzione dell'utente
                      }
                    });
                  });
                }
              }
              console.log(`✅ Aggiornati duplicati esistenti con nuove categorie.`);
            }
            
            if (transactionData.length === 0 && duplicatesToUpdate.length === 0) {
              console.log('⚠️ Nessuna transazione trovata o parsata.');
            }
          } catch (dbError) {
            console.error('❌ Database save error:', dbError);
            throw new Error(`Errore salvataggio database: ${dbError.message}`);
          }

          await prisma.uploadedFile.update({
            where: { id: uploadedFile.id },
            data: {
              transactionCount: categorizedTransactions.length,
              successfulParsing: true,
              parsingMethod: parseResult.method,
              detectedDateRange: parseResult.dateRange,
              detectedBankFormat: parseResult.bankFormat
            }
          });

          await updateCategoryStats(userId);

          totalTransactions += categorizedTransactions.length;

          results.push({
            fileName: file.originalname,
            fileId: uploadedFile.id, // Ã°Å¸â€ â€¢ Aggiungo l'ID del file
            transactionCount: categorizedTransactions.length,
            success: true,
            method: parseResult.method,
            dateRange: parseResult.dateRange,
            bankFormat: parseResult.bankFormat
          });

        } else {
          await prisma.uploadedFile.update({
            where: { id: uploadedFile.id },
            data: {
              successfulParsing: false,
              parsingErrors: parseResult.errors || ['Formato non riconosciuto']
            }
          });

          results.push({
            fileName: file.originalname,
            transactionCount: 0,
            success: false,
            error: parseResult.error || 'Formato non supportato'
          });
        }

      } catch (fileError) {
        console.error(`Error processing file ${file.originalname}:`, fileError);
        results.push({
          fileName: file.originalname,
          transactionCount: 0,
          success: false,
          error: fileError.message
        });
      }
    }

    res.json({
      success: true,
      data: {
        processedFiles: results,
        totalTransactions,
        successfulFiles: results.filter(r => r.success).length
      }
    });

  } catch (error) {
    console.error('Error in file upload:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Errore durante l\'upload dei file'
    });
  }
});

// POST /api/transactions - Aggiungere transazione manuale
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { date, description, amount, category } = req.body;

    if (!date || !description || amount === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Data, descrizione e importo sono obbligatori'
      });
    }

    if (isNaN(parseFloat(amount))) {
      return res.status(400).json({
        success: false,
        error: 'Importo deve essere un numero valido'
      });
    }

    let finalCategory = category;
    if (!finalCategory) {
      // 🎯 USA IL CATEGORIZER UNIFICATO
      const result = await categorizeUltimate({
        description,
        amount: parseFloat(amount)
      }, req.user.id);
      finalCategory = result.category;
    }

    const transaction = await prisma.transaction.create({
      data: {
        date: new Date(date),
        description: description.trim(),
        amount: parseFloat(amount),
        category: finalCategory,
        isVerified: true,
        confidence: 1.0,
        userId: req.user.id
      }
    });

    await updateCategoryStats(req.user.id);

    res.json({
      success: true,
      data: {
        id: transaction.id,
        date: transaction.date.toISOString().split('T')[0],
        description: transaction.description,
        amount: parseFloat(transaction.amount),
        category: transaction.category,
        isVerified: transaction.isVerified
      }
    });

  } catch (error) {
    console.error('Error creating transaction:', error);
    res.status(500).json({
      success: false,
      error: 'Errore nella creazione della transazione'
    });
  }
});

// ✅ PUT /api/transactions/bulk-verify-by-description - Smart Category Learning
// Aggiorna categoria e verifica per TUTTE le transazioni con lo stesso nome merchant
router.put('/bulk-verify-by-description', authenticateToken, async (req, res) => {
  try {
    const { description, category, isVerified, confidence } = req.body;
    const userId = req.user.id;

    if (!description) {
      return res.status(400).json({ success: false, error: 'Descrizione mancante' });
    }

    const updateData = {};
    if (isVerified !== undefined) updateData.isVerified = isVerified;
    if (confidence !== undefined) updateData.confidence = confidence;
    if (category) updateData.category = category;

    const result = await prisma.transaction.updateMany({
      where: { userId, description },
      data: updateData
    });

    console.log(`🧠 Smart Learning: aggiornate ${result.count} transazioni di "${description}"`);

    // ✅ FIX BUG: Salva le keyword per apprendimento futuro (era mancante!)
    if (category) {
      const keywords = extractKeywords(description);
      if (keywords.length > 0) {
        console.log(`📝 Bulk-learning keywords: [${keywords.join(', ')}] → ${category}`);
        await prisma.$transaction(
          keywords.map(keyword => prisma.categoryKeyword.upsert({
            where: { keyword_userId: { keyword: keyword.toLowerCase(), userId } },
            update: { category, weight: 1.0, isUserDefined: true, updatedAt: new Date() },
            create: { keyword: keyword.toLowerCase(), category, weight: 1.0, isUserDefined: true, userId }
          }))
        ).catch(kwError => console.error('Errore batch keyword upsert:', kwError.message));
      }

      // ✅ FIX BUG: Salva anche in MerchantCache per lookup esatto futuro - NORMALIZZATO MAIUSCOLO
      try {
        const cleanDesc = description.trim().toUpperCase();
        await prisma.merchantCache.upsert({
          where: { merchantName: cleanDesc },
          update: { category, confidence: 0.99, updatedAt: new Date() },
          create: { merchantName: cleanDesc, category, confidence: 0.99, source: 'user_verified' }
        });
        console.log(`💾 Merchant cache aggiornata: "${cleanDesc}" → ${category}`);
      } catch (cacheErr) {
        console.error('Errore MerchantCache:', cacheErr.message);
      }
    }

    res.json({
      success: true,
      data: { updatedCount: result.count, description }
    });
  } catch (error) {
    console.error('Error in bulk-verify-by-description:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Ã¢Å“â€¦ PUT /api/transactions/:id - CON LEARNING AUTOMATICO ATTIVATO + BUG FIX
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { date, description, amount, category, isVerified, confidence } = req.body;

    const existingTransaction = await prisma.transaction.findFirst({
      where: { id, userId: req.user.id }
    });

    if (!existingTransaction) {
      return res.status(404).json({
        success: false,
        error: 'Transazione non trovata'
      });
    }

    const updateData = {};
    
    if (date) updateData.date = new Date(date);
    if (description) updateData.description = description.trim();
    if (amount !== undefined) updateData.amount = parseFloat(amount);
    if (category) updateData.category = category;
    if (isVerified !== undefined) updateData.isVerified = isVerified;
    if (confidence !== undefined) updateData.confidence = confidence;

    // Ã¢Å“â€¦ VARIABILE PER TRACCIARE LE KEYWORD APPRESE
    let learnedKeywordsCount = 0;

    // Ã¢Å“â€¦ LEARNING AUTOMATICO ATTIVATO
    if (category && category !== existingTransaction.category) {
      updateData.isVerified = true;
      updateData.confidence = 1.0;
      
      console.log(`Ã°Å¸Â¤â€“ Learning attivato: "${existingTransaction.description}" Ã¢â€ â€™ ${category}`);
      
      // 1Ã¯Â¸ÂÃ¢Æ’Â£ Estrai keywords dalla descrizione
      const keywords = extractKeywords(existingTransaction.description);
      
      if (keywords.length > 0) {
        console.log(`Ã°Å¸â€â€˜ Keywords estratte: [${keywords.join(', ')}]`);
        learnedKeywordsCount = keywords.length;
        
        // 2Ã¯Â¸ÂÃ¢Æ’Â£ Salva le keywords nel database
                // Batch in singola transazione DB invece di N round-trip
        await prisma.$transaction(
          keywords.map(keyword => prisma.categoryKeyword.upsert({
            where: { keyword_userId: { keyword: keyword.toLowerCase(), userId: req.user.id } },
            update: { category, weight: 1.0, isUserDefined: true, updatedAt: new Date() },
            create: { keyword: keyword.toLowerCase(), category, weight: 1.0, isUserDefined: true, userId: req.user.id }
          }))
        ).catch(kwError => console.error('Errore batch keyword upsert:', kwError.message));
        
        console.log(`Ã¢Å“â€¦ Salvate ${keywords.length} keyword per future categorizzazioni`);
        
        // 3Ã¯Â¸ÂÃ¢Æ’Â£ Trova transazioni simili NON verificate
        const similarTransactions = await prisma.transaction.findMany({
          where: {
            userId: req.user.id,
            isVerified: false,
            id: { not: id }, // Escludi la transazione corrente
            AND: keywords.map(kw => ({
              description: {
                contains: kw,
                mode: 'insensitive'
              }
            }))
          },
          select: {
            id: true,
            description: true
          }
        });
        
        if (similarTransactions.length > 0) {
          console.log(`Ã°Å¸â€â€ž Trovate ${similarTransactions.length} transazioni simili da aggiornare`);
          
          // 4Ã¯Â¸ÂÃ¢Æ’Â£ Aggiorna automaticamente le transazioni simili
          const updateResult = await prisma.transaction.updateMany({
            where: {
              id: { in: similarTransactions.map(t => t.id) }
            },
            data: {
              category: category,
              confidence: 0.95, // Alta confidence perchÃƒÂ© basata su learning utente
              isVerified: false // Rimangono da verificare, ma con alta confidence
            }
          });
          
          console.log(`Ã¢Å“â€¦ Aggiornate automaticamente ${updateResult.count} transazioni simili`);
        } else {
          console.log(`Ã¢â€žÂ¹Ã¯Â¸Â Nessuna transazione simile trovata da aggiornare`);
        }
      }
    }

    // 5Ã¯Â¸ÂÃ¢Æ’Â£ Aggiorna la transazione corrente
    const updatedTransaction = await prisma.transaction.update({
      where: { id },
      data: updateData
    });

    // 6Ã¯Â¸ÂÃ¢Æ’Â£ Aggiorna statistiche categorie
    if (category && category !== existingTransaction.category) {
      await updateCategoryStats(req.user.id);
    }

    res.json({
      success: true,
      data: {
        id: updatedTransaction.id,
        date: updatedTransaction.date.toISOString().split('T')[0],
        description: updatedTransaction.description,
        amount: parseFloat(updatedTransaction.amount),
        category: updatedTransaction.category,
        isVerified: updatedTransaction.isVerified,
        confidence: updatedTransaction.confidence
      },
      // Ã¢Å“â€¦ BUG FIX: usa learnedKeywordsCount invece di keywords non definita
      message: learnedKeywordsCount > 0 
        ? `Ã¢Å“â€¦ Categoria aggiornata! Il sistema ha imparato ${learnedKeywordsCount} nuove keyword.`
        : 'Ã¢Å“â€¦ Categoria aggiornata!'
    });

  } catch (error) {
    console.error('Error updating transaction:', error);
    res.status(500).json({
      success: false,
      error: 'Errore nell\'aggiornamento della transazione'
    });
  }
});

// Ã¢Å“â€¦ FUNZIONE PER ESTRARRE KEYWORDS INTELLIGENTI
// extractKeywords ora importata da utils/categorizer

// DELETE /api/transactions/reset - Reset completo database
router.delete('/reset', authenticateToken, async (req, res) => {
  try {
    console.log('Ã°Å¸â€”â€˜Ã¯Â¸Â Inizio reset database per utente:', req.user.id);
    
    const userId = req.user.id;
    
    // Conta quante transazioni verranno eliminate
    const transactionCount = await prisma.transaction.count({
      where: { userId: userId }
    });
    
    const fileCount = await prisma.uploadedFile.count({
      where: { userId: userId }
    });
    
    console.log(`Ã°Å¸â€œÅ  Da eliminare: ${transactionCount} transazioni, ${fileCount} file`);
    
    // Ã¢Å¡Â Ã¯Â¸Â Ordine importante: prima le transazioni (hanno FK verso uploadedFile)
    // poi i file, poi le categorie, poi le keywords
    
    try {
      // 1. Elimina tutte le transazioni dell'utente
      const deletedTransactions = await prisma.transaction.deleteMany({
        where: { userId: userId }
      });
      console.log(`Ã¢Å“â€¦ Eliminate ${deletedTransactions.count} transazioni`);
    } catch (txError) {
      console.error('✘ Errore eliminazione transazioni:', txError);
    }
    
    try {
      // 2. Elimina tutte le keywords apprese dall'utente
    // Elimina keyword apprese dall'utente (se il modello esiste)
    if (prisma.userKeyword) {
      await prisma.userKeyword.deleteMany({ where: { userId: userId } });
    }
      console.log(`✅ Eliminate keywords`);
    } catch (kwError) {
      console.error('✘ Errore eliminazione keywords:', kwError);
    }
    
    try {
      // 3. Elimina tutti i file caricati dall'utente
      const deletedFiles = await prisma.uploadedFile.deleteMany({
        where: { userId: userId }
      });
      console.log(`Ã¢Å“â€¦ Eliminati ${deletedFiles.count} file`);
    } catch (fileError) {
      console.error('Ã¢ÂÅ’ Errore eliminazione file:', fileError);
    }
    
    try {
      // 4. Elimina tutte le categorie dell'utente
      const deletedCategories = await prisma.category.deleteMany({
        where: { userId: userId }
      });
      console.log(`Ã¢Å“â€¦ Eliminate ${deletedCategories.count} categorie`);
    } catch (catError) {
      console.error('Ã¢ÂÅ’ Errore eliminazione categorie:', catError);
    }
    
    console.log('Ã¢Å“â€¦ Database resettato con successo');
    
    res.json({
      success: true,
      message: `Database resettato con successo. Eliminate ${transactionCount} transazioni e ${fileCount} file.`,
      data: {
        deletedTransactions: transactionCount,
        deletedFiles: fileCount
      }
    });

  } catch (error) {
    console.error('Ã¢ÂÅ’ Errore nel reset del database:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Errore nel reset del database',
      details: error.message
    });
  }
});

// DELETE /api/transactions/:id
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const existingTransaction = await prisma.transaction.findFirst({
      where: { id, userId: req.user.id }
    });

    if (!existingTransaction) {
      return res.status(404).json({
        success: false,
        error: 'Transazione non trovata'
      });
    }

    await prisma.transaction.delete({
      where: { id }
    });

    await updateCategoryStats(req.user.id);

    res.json({
      success: true,
      message: 'Transazione eliminata con successo'
    });

  } catch (error) {
    console.error('Error deleting transaction:', error);
    res.status(500).json({
      success: false,
      error: 'Errore nell\'eliminazione della transazione'
    });
  }
});

// GET /api/transactions/files
router.get('/files', authenticateToken, async (req, res) => {
  try {
    const files = await prisma.uploadedFile.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { transactions: true }
        }
      }
    });

    res.json({
      success: true,
      data: files.map(file => ({
        id: file.id,
        originalName: file.originalName,
        fileSize: file.fileSize,
        transactionCount: file._count.transactions,
        successfulParsing: file.successfulParsing,
        parsingMethod: file.parsingMethod,
        detectedDateRange: file.detectedDateRange,
        detectedBankFormat: file.detectedBankFormat,
        uploadedAt: file.createdAt
      }))
    });

  } catch (error) {
    console.error('Error fetching uploaded files:', error);
    res.status(500).json({
      success: false,
      error: 'Errore nel recupero dei file caricati'
    });
  }
});

// ✅ ENDPOINT CATEGORIE - SPOSTATO PRIMO per evitare conflitti di routing
router.get('/category-details/:categoryName', authenticateToken, async (req, res) => {
  try {
    const { categoryName } = req.params;
    const { where, userId } = await buildTransactionWhere(req);
    
    // Forza la categoria corretta nel dove
    where.category = categoryName;

    console.log('🎯 Detailed Category Query:', JSON.stringify(where, null, 2));

    console.log('Ã°Å¸â€ Â  Query where:', JSON.stringify(where, null, 2));

    const transactions = await prisma.transaction.findMany({
      where,
      orderBy: { date: 'desc' },
      include: {
        uploadedFile: {
          select: { originalName: true }
        }
      }
    });

    // Ã¢Å“â€¦ Calcola il totale SOLO sulle transazioni filtrate
    const total = transactions.reduce((sum, t) => sum + Math.abs(parseFloat(t.amount)), 0);

    console.log(`✅ Category "${categoryName}": ${transactions.length} transazioni, totale: €${total.toFixed(2)}, filter: ${JSON.stringify(where)}`);

    res.json({
      success: true,
      data: {
        category: categoryName,
        transactions: transactions.map(t => ({
          id: t.id,
          date: t.date.toISOString().split('T')[0],
          description: t.description,
          amount: parseFloat(t.amount),
          isVerified: t.isVerified,
          confidence: t.confidence,
          sourceFile: t.uploadedFile?.originalName
        })),
        stats: {
          total: total,
          count: transactions.length
        }
      }
    });

  } catch (error) {
    console.error('Error fetching category transactions:', error);
    res.status(500).json({
      success: false,
      error: 'Errore nel recupero delle transazioni per categoria'
    });
  }
});

// Utility function per aggiornare statistiche categorie
async function updateCategoryStats(userId) {
  try {
    const categoryStats = await prisma.transaction.groupBy({
      by: ['category'],
      where: { userId },
      _sum: { amount: true },
      _count: true,
      _max: { date: true }
    });

    // Batch upsert in singola transazione DB: O(1) round-trip invece di O(n)
    await prisma.$transaction(
      categoryStats.map(stat => {
        const amount = parseFloat(stat._sum.amount || 0);
        return prisma.category.upsert({
          where: { name_userId: { name: stat.category, userId } },
          update: { totalAmount: Math.abs(amount), transactionCount: stat._count, lastUsed: stat._max.date },
          create: {
            name: stat.category,
            emoji: DEFAULT_CATEGORIES[stat.category]?.emoji || '💸',
            color: DEFAULT_CATEGORIES[stat.category]?.color || '#94a3b8',
            isIncome: amount > 0,
            totalAmount: Math.abs(amount),
            transactionCount: stat._count,
            lastUsed: stat._max.date,
            userId
          }
        });
      })
    );

    console.log(`Updated stats for ${categoryStats.length} categories`);

  } catch (error) {
    console.error('Error updating category stats:', error);
  }
}

// Helper functions con NUOVE CATEGORIE
function getCategoryEmoji(category) {
  const emojiMap = {
    'Alimentari': 'Ã°Å¸â€ºâ€™',
    'Trasporti': 'Ã°Å¸Å¡â€”', 
    'Ristoranti': 'Ã°Å¸Â Â½Ã¯Â¸Â ',
    'Bollette': 'Ã¢Å¡Â¡',
    'Shopping': '🛍️',
    'Casa': 'Ã°Å¸Â Â ',
    'Salute': 'Ã°Å¸â€™Å ',
    'Intrattenimento': 'Ã°Å¸Å½Â¬',
    'Sport': 'Ã¢Å¡Â½',
    'Educazione': 'Ã°Å¸â€œÅ¡',
    'Tecnologia': 'Ã°Å¸â€™Â»',
    'Stipendio': 'Ã°Å¸â€™Â°',
    'Entrate Varie': 'Ã°Å¸â€™Â°',
    'Altre Spese': 'Ã°Å¸â€™Â¸',
    'Acquisti Online': 'Ã°Å¸â€œÂ¦',
    'Paghetta': 'Ã°Å¸â€˜Â¶',
    'Bonifico': 'Ã°Å¸â€™Â³'
  };
  return emojiMap[category] || 'Ã°Å¸â€™Â¸';
}

function getCategoryColor(category) {
  const colorMap = {
    'Alimentari': '#4ecdc4',
    'Trasporti': '#45b7d1',
    'Ristoranti': '#ff6b6b',
    'Bollette': '#feca57',
    'Shopping': '#ff9ff3',
    'Casa': '#96ceb4',
    'Salute': '#f87171',
    'Intrattenimento': '#54a0ff',
    'Sport': '#5f27cd',
    'Educazione': '#00d2d3',
    'Tecnologia': '#48dbfb',
    'Benessere': '#ee5a6f',
    'Stipendio': '#4ade80',
    'Entrate Varie': '#4ade80',
    'Altre Spese': '#ff9f43',
    'Acquisti Online': '#9b59b6',
    'Paghetta': '#fbbf24',
    'Bonifico': '#8b5cf6'
  };
  return colorMap[category] || '#f87171';
}

// GET /api/transactions/google-places-stats - Statistiche Google Places API
const googlePlacesService = require('../utils/googlePlacesService');

router.get('/google-places-stats', authenticateToken, async (req, res) => {
  try {
    const stats = googlePlacesService.getStats();
    
    // Calcola soglia gratuita (Tier Essentials = 10.000 chiamate/mese)
    const freeLimit = 10000;
    const costPerExcessCall = 0.035;
    
    let estimatedCost = 0;
    if (stats.apiCalls > freeLimit) {
      estimatedCost = ((stats.apiCalls - freeLimit) * costPerExcessCall).toFixed(2);
    }
    
    const remaining = Math.max(0, freeLimit - stats.apiCalls);
    const percentUsed = ((stats.apiCalls / freeLimit) * 100).toFixed(1) + '%';
    
    res.json({
      success: true,
      data: {
        ...stats,
        costs: {
          freeLimit: freeLimit,
          apiCallCost: costPerExcessCall,
          totalCost: estimatedCost,
          percentUsed: percentUsed,
          remaining: remaining,
          isWithinFreeTier: stats.apiCalls <= freeLimit
        },
        enabled: process.env.GOOGLE_PLACES_ENABLED === 'true'
      }
    });
    
  } catch (error) {
    console.error('Error fetching Google Places stats:', error);
    res.status(500).json({
      success: false,
      error: 'Errore nel recupero delle statistiche'
    });
  }
});

module.exports = router;