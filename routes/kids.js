const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

/**
 * UTILS: Ricalcola il saldo di un figlio
 */
async function recalculateKidBalance(kidId) {
  const kid = await prisma.kid.findUnique({
    where: { id: kidId },
    include: { allowanceHistory: true }
  });

  if (!kid) return 0;

  const transactions = await prisma.transaction.aggregate({
    where: { kidId },
    _sum: { amount: true }
  });

  const historySum = await prisma.allowanceHistory.aggregate({
    where: { kidId },
    _sum: { amount: true }
  });

  // Saldo = Somma dei bonifici ricevuti (che sono negativi nel DB se spese per il genitore)
  // Qui decidiamo: se la transazione è una spesa per il genitore (-30€), per il figlio è un'entrata (+30€).
  const txSum = Math.abs(parseFloat(transactions._sum.amount?.toString() || "0"));
  const hSum = parseFloat(historySum._sum.amount?.toString() || "0");
  
  const balance = txSum + hSum;

  await prisma.kid.update({
    where: { id: kidId },
    data: { balance }
  });

  return balance;
}

// GET /api/kids - Lista figli
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const kids = await prisma.kid.findMany({
      where: { userId },
      include: {
        _count: {
          select: { transactions: true }
        }
      },
      orderBy: { name: 'asc' }
    });

    res.json({
      success: true,
      data: kids.map(k => ({
        ...k,
        balance: parseFloat(k.balance),
        allowance: parseFloat(k.allowance),
        transactionCount: k._count.transactions
      }))
    });
  } catch (error) {
    console.error('Error fetching kids:', error);
    res.status(500).json({ success: false, error: 'Errore nel recupero dei figli' });
  }
});

// POST /api/kids - Aggiungi figlio
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, age, allowance } = req.body;
    const userId = req.user.id;

    if (!name) {
      return res.status(400).json({ success: false, error: 'Il nome è obbligatorio' });
    }

    const kid = await prisma.kid.create({
      data: {
        name,
        age: parseInt(age || 0),
        allowance: parseFloat(allowance || 0),
        userId
      }
    });

    res.json({ success: true, data: kid });
  } catch (error) {
    console.error('Error creating kid:', error);
    res.status(500).json({ success: false, error: 'Errore nella creazione del profilo' });
  }
});

// GET /api/kids/:id - Dettaglio figlio e transazioni
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const kid = await prisma.kid.findFirst({
      where: { id, userId },
      include: {
        transactions: {
          orderBy: { date: 'desc' }
        },
        allowanceHistory: {
          orderBy: { date: 'desc' }
        }
      }
    });

    if (!kid) {
      return res.status(404).json({ success: false, error: 'Figlio non trovato' });
    }

    res.json({
      success: true,
      data: {
        ...kid,
        balance: parseFloat(kid.balance),
        allowance: parseFloat(kid.allowance),
        transactions: kid.transactions.map(t => ({
          ...t,
          amount: parseFloat(t.amount)
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching kid details:', error);
    res.status(500).json({ success: false, error: 'Errore nel recupero dei dettagli' });
  }
});

// POST /api/kids/:id/link - Collega transazione a un figlio
router.post('/:id/link', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { transactionIds } = req.body;
    const userId = req.user.id;

    await prisma.transaction.updateMany({
      where: {
        id: { in: transactionIds },
        userId
      },
      data: { kidId: id, category: 'Paghette' }
    });

    const balance = await recalculateKidBalance(id);

    res.json({ success: true, balance });
  } catch (error) {
    console.error('Error linking transaction to kid:', error);
    res.status(500).json({ success: false, error: 'Errore nel collegamento' });
  }
});

module.exports = router;
