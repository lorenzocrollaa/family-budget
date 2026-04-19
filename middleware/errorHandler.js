// middleware/errorHandler.js

const { PrismaClientKnownRequestError } = require('@prisma/client');

/**
 * Error handling middleware globale per l'app Express
 * Gestisce errori Prisma, validazione, e errori generici
 */
function errorHandler(err, req, res, next) {
  console.error('Error caught by middleware:', {
    error: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    timestamp: new Date().toISOString()
  });

  // Errori Prisma specifici
  if (err instanceof PrismaClientKnownRequestError) {
    return handlePrismaError(err, res);
  }

  // Errori JWT
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      error: 'Token non valido'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error: 'Token scaduto, effettua nuovamente il login'
    });
  }

  // Errori Multer (upload file)
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      error: 'File troppo grande. Limite: 10MB'
    });
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      success: false,
      error: 'Tipo di file non supportato'
    });
  }

  // Errori validazione
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: 'Dati non validi',
      details: err.details || err.message
    });
  }

  // Errori rate limiting
  if (err.status === 429) {
    return res.status(429).json({
      success: false,
      error: 'Troppi tentativi, riprova più tardi'
    });
  }

  // Errori HTTP standard
  if (err.status && err.message) {
    return res.status(err.status).json({
      success: false,
      error: err.message
    });
  }

  // Errore generico del server
  res.status(500).json({
    success: false,
    error: 'Errore interno del server',
    ...(process.env.NODE_ENV === 'development' && {
      details: err.message,
      stack: err.stack
    })
  });
}

/**
 * Gestisce errori specifici di Prisma Database
 */
function handlePrismaError(err, res) {
  switch (err.code) {
    case 'P2000':
      return res.status(400).json({
        success: false,
        error: 'Il valore fornito per il campo è troppo lungo'
      });

    case 'P2002':
      const target = err.meta?.target;
      let field = 'campo';
      
      if (target && Array.isArray(target)) {
        if (target.includes('email')) field = 'email';
        else if (target.includes('name')) field = 'nome';
      }

      return res.status(409).json({
        success: false,
        error: `${field.charAt(0).toUpperCase() + field.slice(1)} già in uso`
      });

    case 'P2003':
      return res.status(400).json({
        success: false,
        error: 'Riferimento non valido - record collegato non trovato'
      });

    case 'P2004':
      return res.status(400).json({
        success: false,
        error: 'Violazione del vincolo nel database'
      });

    case 'P2014':
      return res.status(400).json({
        success: false,
        error: 'La modifica violerebbe una relazione richiesta'
      });

    case 'P2025':
      return res.status(404).json({
        success: false,
        error: 'Record non trovato'
      });

    default:
      return res.status(500).json({
        success: false,
        error: 'Errore del database',
        ...(process.env.NODE_ENV === 'development' && {
          code: err.code,
          details: err.message
        })
      });
  }
}

/**
 * Wrapper per funzioni async per catturare errori automaticamente
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Middleware per validazione richieste
 */
function validateRequest(schema) {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      const err = new Error(error.details[0].message);
      err.name = 'ValidationError';
      err.details = error.details;
      return next(err);
    }
    next();
  };
}

/**
 * Logger per richieste HTTP
 */
function requestLogger(req, res, next) {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      timestamp: new Date().toISOString()
    };

    // Log errori e richieste lente
    if (res.statusCode >= 400 || duration > 1000) {
      console.warn('Slow/Error request:', logData);
    } else if (process.env.NODE_ENV === 'development') {
      console.log('Request:', logData);
    }
  });

  next();
}

/**
 * Rate limiting personalizzato per utente autenticato
 */
function createUserRateLimit(options = {}) {
  const {
    windowMs = 15 * 60 * 1000, // 15 minuti
    maxRequests = 100,
    message = 'Limite richieste raggiunto'
  } = options;

  const userLimits = new Map();

  return (req, res, next) => {
    const userId = req.user?.id;
    if (!userId) return next();

    const now = Date.now();
    const userLimit = userLimits.get(userId) || { requests: [], windowStart: now };

    // Pulisci richieste vecchie
    userLimit.requests = userLimit.requests.filter(
      time => now - time < windowMs
    );

    // Controlla limite
    if (userLimit.requests.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        error: message,
        retryAfter: Math.ceil((windowMs - (now - userLimit.requests[0])) / 1000)
      });
    }

    // Aggiungi richiesta corrente
    userLimit.requests.push(now);
    userLimits.set(userId, userLimit);

    next();
  };
}

/**
 * Middleware per gestire CORS in modo più granulare
 */
function configureCORS(req, res, next) {
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    process.env.FRONTEND_URL
  ].filter(Boolean);

  const origin = req.headers.origin;
  
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 ore

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }

  next();
}

/**
 * Middleware per sanitizzazione input
 */
function sanitizeInput(req, res, next) {
  // Sanitizza body parameters
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }

  // Sanitizza query parameters
  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeObject(req.query);
  }

  next();
}

function sanitizeObject(obj) {
  const sanitized = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      // Rimuovi caratteri pericolosi
      sanitized[key] = value
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+=/gi, '')
        .trim();
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map(item => 
        typeof item === 'string' ? sanitizeObject({ temp: item }).temp : item
      );
    } else if (value && typeof value === 'object') {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

module.exports = {
  errorHandler,
  asyncHandler,
  validateRequest,
  requestLogger,
  createUserRateLimit,
  configureCORS,
  sanitizeInput
};