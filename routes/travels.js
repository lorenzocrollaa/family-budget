const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

/**
 * UTILS: Ricalcola il totale speso per un viaggio
 */
async function recalculateTravelSpent(travelId) {
  const transactions = await prisma.transaction.aggregate({
    where: { travelId },
    _sum: { amount: true }
  });

  const expenses = await prisma.travelExpense.aggregate({
    where: { travelId },
    _sum: { amount: true }
  });

  // Note: Transactions are negative for expenses, positive for income.
  // We usually want the absolute value of expenses for a "spent" metric.
  const txSum = parseFloat(transactions._sum.amount?.toString() || "0");
  const expSum = parseFloat(expenses._sum.amount?.toString() || "0");
  
  // Total spent is the (absolute value of negative transactions) + manual expenses
  const totalSpent = Math.abs(txSum < 0 ? txSum : 0) + expSum;

  await prisma.travel.update({
    where: { id: travelId },
    data: { spent: totalSpent }
  });

  return totalSpent;
}

// GET /api/travels - Lista viaggi utente
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const travels = await prisma.travel.findMany({
      where: { userId },
      include: {
        _count: {
          select: { transactions: true, expenses: true }
        }
      },
      orderBy: { startDate: 'desc' }
    });

    res.json({
      success: true,
      data: travels.map(t => ({
        ...t,
        spent: parseFloat(t.spent),
        budget: parseFloat(t.budget),
        transactionCount: t._count.transactions,
        expenseCount: t._count.expenses
      }))
    });
  } catch (error) {
    console.error('Error fetching travels:', error);
    res.status(500).json({ success: false, error: 'Errore nel recupero dei viaggi' });
  }
});

// POST /api/travels - Crea nuovo viaggio
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { destination, startDate, endDate, budget } = req.body;
    const userId = req.user.id;

    if (!destination || !startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'Destinazione e date sono obbligatorie' });
    }

    const travel = await prisma.travel.create({
      data: {
        destination,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        budget: parseFloat(budget || 0),
        userId
      }
    });

    res.json({ success: true, data: travel });
  } catch (error) {
    console.error('Error creating travel:', error);
    res.status(500).json({ success: false, error: 'Errore nella creazione del viaggio' });
  }
});

// GET /api/travels/:id - Dettaglio viaggio
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const travel = await prisma.travel.findFirst({
      where: { id, userId },
      include: {
        transactions: {
          orderBy: { date: 'desc' }
        },
        expenses: {
          orderBy: { date: 'desc' }
        }
      }
    });

    if (!travel) {
      return res.status(404).json({ success: false, error: 'Viaggio non trovato' });
    }

    res.json({
      success: true,
      data: {
        ...travel,
        spent: parseFloat(travel.spent),
        budget: parseFloat(travel.budget),
        transactions: travel.transactions.map(t => ({
          ...t,
          amount: parseFloat(t.amount),
          date: t.date.toISOString().split('T')[0]
        })),
        expenses: travel.expenses.map(e => ({
          ...e,
          amount: parseFloat(e.amount),
          date: e.date.toISOString().split('T')[0]
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching travel details:', error);
    res.status(500).json({ success: false, error: 'Errore nel recupero dei dettagli del viaggio' });
  }
});

// POST /api/travels/:id/transactions - Aggiungi transazioni esistenti al viaggio
router.post('/:id/transactions', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { transactionIds } = req.body;
    const userId = req.user.id;

    if (!transactionIds || !Array.isArray(transactionIds)) {
      return res.status(400).json({ success: false, error: 'Lista ID transazioni non valida' });
    }

    // Verifica che il viaggio appartenga all'utente
    const travel = await prisma.travel.findFirst({
      where: { id, userId }
    });

    if (!travel) {
      return res.status(404).json({ success: false, error: 'Viaggio non trovato' });
    }

    // Aggiorna le transazioni
    const result = await prisma.transaction.updateMany({
      where: {
        id: { in: transactionIds },
        userId: userId
      },
      data: { travelId: id }
    });

    // Ricalcola il totale speso
    const totalSpent = await recalculateTravelSpent(id);

    res.json({
      success: true,
      data: {
        count: result.count,
        totalSpent
      }
    });
  } catch (error) {
    console.error('Error adding transactions to travel:', error);
    res.status(500).json({ success: false, error: 'Errore nell\'aggiunta delle transazioni al viaggio' });
  }
});

// DELETE /api/travels/:id/transactions/:transactionId - Rimuovi transazione dal viaggio
router.delete('/:id/transactions/:transactionId', authenticateToken, async (req, res) => {
  try {
    const { id, transactionId } = req.params;
    const userId = req.user.id;

    // Verifica che la transazione appartenga all'utente e al viaggio
    const transaction = await prisma.transaction.findFirst({
      where: { id: transactionId, userId, travelId: id }
    });

    if (!transaction) {
      return res.status(404).json({ success: false, error: 'Transazione non trovata in questo viaggio' });
    }

    // Disconnetti la transazione
    await prisma.transaction.update({
      where: { id: transactionId },
      data: { travelId: null }
    });

    // Ricalcola il totale speso
    const totalSpent = await recalculateTravelSpent(id);

    res.json({
      success: true,
      data: { totalSpent }
    });
  } catch (error) {
    console.error('Error removing transaction from travel:', error);
    res.status(500).json({ success: false, error: 'Errore nella rimozione della transazione dal viaggio' });
  }
});

// DELETE /api/travels/:id - Elimina viaggio
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const travel = await prisma.travel.findFirst({
      where: { id, userId }
    });

    if (!travel) {
      return res.status(404).json({ success: false, error: 'Viaggio non trovato' });
    }

    // Rimuovi travelId dalle transazioni associate
    await prisma.transaction.updateMany({
      where: { travelId: id },
      data: { travelId: null }
    });

    await prisma.travel.delete({
      where: { id }
    });

    res.json({ success: true, message: 'Viaggio eliminato correttamente' });
  } catch (error) {
    console.error('Error deleting travel:', error);
    res.status(500).json({ success: false, error: 'Errore nell\'eliminazione del viaggio' });
  }
});

// PUT /api/travels/:id - Aggiorna viaggio
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { destination, startDate, endDate, budget } = req.body;
    const userId = req.user.id;

    const travel = await prisma.travel.findFirst({
      where: { id, userId }
    });

    if (!travel) {
      return res.status(404).json({ success: false, error: 'Viaggio non trovato' });
    }

    const updatedTravel = await prisma.travel.update({
      where: { id },
      data: {
        destination: destination || undefined,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        budget: budget !== undefined ? parseFloat(budget) : undefined
      }
    });

    res.json({ success: true, data: updatedTravel });
  } catch (error) {
    console.error('Error updating travel:', error);
    res.status(500).json({ success: false, error: 'Errore nell\'aggiornamento del viaggio' });
  }
});

module.exports = router;
