// routes/categories.js - API per gestione categorie con Prelievi

const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../middleware/auth');
const { 
  categorizeUltimate, 
  DEFAULT_CATEGORIES,
  getCategorizationStats
} = require('../utils/ultimateCategorizer');

const router = express.Router();
const prisma = new PrismaClient();

const { getMetadata } = require('../utils/categoryMetadata');

// Helper functions (ora usano la Sorgente di Verità)
function getCategoryEmoji(category) {
  return getMetadata(category).emoji;
}

function getCategoryColor(category) {
  return getMetadata(category).color;
}

// GET /api/categories - Lista tutte le categorie
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userCategories = await prisma.category.findMany({
      where: { userId: req.user.id },
      orderBy: { lastUsed: 'desc' },
      include: {
        _count: {
          select: { transactions: true }
        }
      }
    });

    const allCategories = [];

    // Aggiungi categorie default
    for (const [name, data] of Object.entries(DEFAULT_CATEGORIES)) {
      allCategories.push({
        name,
        emoji: data.emoji,
        color: data.color,
        isIncome: data.isIncome,
        isDefault: true,
        isCustom: false,
        totalAmount: 0,
        transactionCount: 0,
        keywords: data.patterns
      });
    }

    // Aggiungi categorie personalizzate
    for (const category of userCategories) {
      allCategories.push({
        name: category.name,
        emoji: category.emoji,
        color: category.color,
        isIncome: category.isIncome,
        isDefault: false,
        isCustom: true,
        totalAmount: parseFloat(category.totalAmount),
        transactionCount: category.transactionCount,
        keywords: category.keywords,
        lastUsed: category.lastUsed,
        createdAt: category.createdAt
      });
    }

    res.json({
      success: true,
      data: allCategories
    });

  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({
      success: false,
      error: 'Errore nel recupero delle categorie'
    });
  }
});

// GET /api/categories/stats - Statistiche categorizzazione
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    const where = {
      userId: req.user.id
    };

    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = new Date(dateFrom);
      if (dateTo) where.date.lte = new Date(dateTo);
    }

    const expenseStats = await prisma.transaction.groupBy({
      by: ['category'],
      where: {
        ...where,
        amount: { lt: 0 }
      },
      _sum: { amount: true },
      _count: true,
      _avg: { confidence: true },
      orderBy: { _sum: { amount: 'asc' } }
    });

    const incomeStats = await prisma.transaction.groupBy({
      by: ['category'],
      where: {
        ...where,
        amount: { gt: 0 }
      },
      _sum: { amount: true },
      _count: true,
      _avg: { confidence: true }
    });

    const totalExpenses = expenseStats.reduce((sum, cat) => 
      sum + Math.abs(parseFloat(cat._sum.amount || 0)), 0
    );
    
    const totalIncome = incomeStats.reduce((sum, cat) => 
      sum + parseFloat(cat._sum.amount || 0), 0
    );

    const accuracyStats = await getCategorizationStats(req.user.id);

    res.json({
      success: true,
      data: {
        expenses: {
          total: totalExpenses,
          byCategory: expenseStats.map(cat => ({
            category: cat.category,
            amount: Math.abs(parseFloat(cat._sum.amount)),
            color: getMetadata(cat.category).color,
            emoji: getMetadata(cat.category).emoji,
            percentage: totalExpenses > 0 ? 
              Math.abs(parseFloat(cat._sum.amount)) / totalExpenses * 100 : 0,
            transactionCount: cat._count,
            averageConfidence: parseFloat(cat._avg.confidence || 0)
          }))
        },
        income: {
          total: totalIncome,
          byCategory: incomeStats.map(cat => ({
            category: cat.category,
            amount: parseFloat(cat._sum.amount),
            color: getMetadata(cat.category).color,
            emoji: getMetadata(cat.category).emoji,
            percentage: totalIncome > 0 ? 
              parseFloat(cat._sum.amount) / totalIncome * 100 : 0,
            transactionCount: cat._count,
            averageConfidence: parseFloat(cat._avg.confidence || 0)
          }))
        },
        accuracy: accuracyStats
      }
    });

  } catch (error) {
    console.error('Error calculating category stats:', error);
    res.status(500).json({
      success: false,
      error: 'Errore nel calcolo delle statistiche categorie'
    });
  }
});

// POST /api/categories - Crea categoria personalizzata
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, emoji, color, isIncome, keywords } = req.body;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Nome categoria obbligatorio'
      });
    }

    const existingCategory = await prisma.category.findUnique({
      where: {
        name_userId: {
          name: name.trim(),
          userId: req.user.id
        }
      }
    });

    if (existingCategory) {
      return res.status(400).json({
        success: false,
        error: 'Categoria con questo nome già esistente'
      });
    }

    const category = await prisma.category.create({
      data: {
        name: name.trim(),
        emoji: emoji || (isIncome ? '💰' : '💸'),
        color: color || (isIncome ? '#4ade80' : '#f87171'),
        isIncome: Boolean(isIncome),
        keywords: keywords || [],
        userId: req.user.id
      }
    });

    res.json({
      success: true,
      data: {
        name: category.name,
        emoji: category.emoji,
        color: category.color,
        isIncome: category.isIncome,
        keywords: category.keywords,
        createdAt: category.createdAt
      }
    });

  } catch (error) {
    console.error('Error creating category:', error);
    res.status(500).json({
      success: false,
      error: 'Errore nella creazione della categoria'
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

    for (const stat of categoryStats) {
      const amount = parseFloat(stat._sum.amount || 0);
      
      await prisma.category.upsert({
        where: {
          name_userId: {
            name: stat.category,
            userId: userId
          }
        },
        update: {
          totalAmount: Math.abs(amount),
          transactionCount: stat._count,
          lastUsed: stat._max.date,
          emoji: getCategoryEmoji(stat.category),
          color: getCategoryColor(stat.category)
        },
        create: {
          name: stat.category,
          emoji: getCategoryEmoji(stat.category),
          color: getCategoryColor(stat.category),
          isIncome: amount > 0,
          totalAmount: Math.abs(amount),
          transactionCount: stat._count,
          lastUsed: stat._max.date,
          userId: userId
        }
      });
    }

    console.log(`Updated stats for ${categoryStats.length} categories`);

  } catch (error) {
    console.error('Error updating category stats:', error);
  }
}

module.exports = router;