// app.js - Server Express.js principale con integrazione API

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');

// Import routes
const authRoutes = require('./routes/auth');
const transactionRoutes = require('./routes/transactions');
const categoryRoutes = require('./routes/categories');
const travelRoutes = require('./routes/travels');
const kidRoutes = require('./routes/kids');
const bankRoutes = require('./routes/bank');
const stripeRoutes = require('./routes/stripe');

// Import middleware
const { authenticateToken } = require('./middleware/auth');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3000;

// Security & Performance Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net", "https://unpkg.com", "https://cdn.plaid.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://cdn.jsdelivr.net", "https://unpkg.com", "https://cdn.plaid.com", "https://*.plaid.com"],
      frameSrc: ["'self'", "https://*.plaid.com"],
    },
  },
}));

app.use(compression());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'Troppi tentativi, riprova tra 15 minuti'
  }
});

const uploadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // 10 uploads every 5 minutes
  message: {
    error: 'Limite upload raggiunto, riprova tra 5 minuti'
  }
});

app.use('/api/', limiter);
app.use('/api/transactions/upload', uploadLimiter);

// Webhook Plaid: raw body PRIMA del json parser globale
app.use('/api/bank/webhook', express.raw({ type: 'application/json' }));
// Stripe webhook richiede raw body PRIMA del json parser
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Ensure upload directories exist
const uploadDirs = ['uploads/statements', 'uploads/temp'];
uploadDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/travels', travelRoutes);
app.use('/api/kids', kidRoutes);
app.use('/api/bank', bankRoutes);
app.use('/api/stripe', stripeRoutes);

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API Info endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'Family Budget Tracker API',
    version: '1.0.0',
    description: 'API per la gestione del budget familiare con parsing automatico di estratti conto',
    endpoints: {
      auth: {
        'POST /api/auth/register': 'Registrazione utente',
        'POST /api/auth/login': 'Login utente',
        'GET /api/auth/profile': 'Profilo utente (auth richiesta)'
      },
      transactions: {
        'GET /api/transactions': 'Lista transazioni con filtri',
        'POST /api/transactions': 'Crea transazione manuale',
        'PUT /api/transactions/:id': 'Modifica transazione',
        'DELETE /api/transactions/:id': 'Elimina transazione',
        'GET /api/transactions/stats': 'Statistiche transazioni',
        'POST /api/transactions/upload': 'Upload estratti conto',
        'GET /api/transactions/files': 'Lista file caricati',
        'POST /api/transactions/batch': 'Import batch transazioni'
      },
      categories: {
        'GET /api/categories': 'Lista categorie',
        'POST /api/categories': 'Crea categoria personalizzata',
        'PUT /api/categories/:name': 'Modifica categoria',
        'DELETE /api/categories/:name': 'Elimina categoria',
        'GET /api/categories/stats': 'Statistiche per categoria',
        'GET /api/categories/:name/transactions': 'Transazioni per categoria',
        'POST /api/categories/suggest': 'Suggerimenti categorizzazione',
        'POST /api/categories/batch-update': 'Aggiornamento batch',
        'GET /api/categories/export': 'Esporta configurazione',
        'POST /api/categories/import': 'Importa configurazione'
      }
    },
    features: [
      'Upload multipli formati (PDF, CSV, TXT, JSON, QIF, OFX, MT940)',
      'Parsing automatico estratti conto italiani',
      'Categorizzazione automatica AI/ML',
      'Filtri avanzati per data, categoria, importo',
      'Statistiche dettagliate e analytics',
      'Categorie personalizzate con keyword learning',
      'Sicurezza con rate limiting e autenticazione JWT',
      'API RESTful con paginazione e validazione'
    ]
  });
});

// Frontend route (serve la tua app HTML)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Demo data endpoint per testing frontend
app.get('/api/demo-data', (req, res) => {
  const demoTransactions = [
    {
      id: 'demo-1',
      date: '2024-12-01',
      description: 'Stipendio Dicembre',
      amount: 2200.00,
      category: 'Stipendio'
    },
    {
      id: 'demo-2',
      date: '2024-12-01',
      description: 'Supermercato Conad',
      amount: -85.40,
      category: 'Alimentari'
    },
    {
      id: 'demo-3',
      date: '2024-11-30',
      description: 'Benzina Shell',
      amount: -67.80,
      category: 'Trasporti'
    },
    {
      id: 'demo-4',
      date: '2024-11-29',
      description: 'Pizzeria da Mario',
      amount: -28.50,
      category: 'Ristoranti'
    },
    {
      id: 'demo-5',
      date: '2024-11-28',
      description: 'Bolletta Enel',
      amount: -120.50,
      category: 'Bollette'
    }
  ];

  const demoCategories = {
    'Alimentari': { amount: 234.50, transactions: 8 },
    'Trasporti': { amount: 145.30, transactions: 5 },
    'Ristoranti': { amount: 89.20, transactions: 4 },
    'Bollette': { amount: 287.90, transactions: 3 },
    'Stipendio': { amount: 2200.00, transactions: 1 }
  };

  res.json({
    success: true,
    data: {
      transactions: demoTransactions,
      categories: demoCategories,
      stats: {
        totalIncome: 2200.00,
        totalExpenses: 757.40,
        balance: 1442.60,
        totalTransactions: 5
      }
    }
  });
});

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  if (req.originalUrl.startsWith('/api/')) {
    res.status(404).json({
      success: false,
      error: 'Endpoint API non trovato',
      path: req.originalUrl
    });
  } else {
    // Serve frontend app per tutte le altre route (SPA routing)
    res.sendFile(path.join(__dirname, 'public/index.html'));
  }
});

// Validate required secrets at startup
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be set and at least 32 characters long');
  process.exit(1);
}

// Start server
app.listen(PORT, () => {
  console.log(`
🚀 Family Budget Tracker API
📡 Server running on: http://localhost:${PORT}
🏠 Frontend: http://localhost:${PORT}
📖 API Docs: http://localhost:${PORT}/api
💾 Environment: ${process.env.NODE_ENV || 'development'}

📋 Available Features:
✅ Authentication (JWT)
✅ File Upload & Parsing (PDF, CSV, TXT, JSON, QIF, OFX, MT940)
✅ Automatic Categorization (AI/ML)
✅ Advanced Filtering & Statistics
✅ Custom Categories with Learning
✅ Security & Rate Limiting

📁 Next Steps:
1. Setup database: npx prisma migrate dev
2. Create uploads folder: mkdir -p uploads/statements
3. Configure environment variables
4. Test endpoints with your frontend
  `);
});

module.exports = app;