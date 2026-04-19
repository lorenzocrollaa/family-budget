/**
 * 🎨 CATEGORY METADATA - UNICA SORGENTE DI VERITÀ
 * Questo file centralizza icone, colori ed emojii per tutte le categorie dell'app.
 * Modificare qui per aggiornare lo stile in tutta la dashboard e nei report.
 */

const CATEGORY_METADATA = {
  'Alimentari': {
    emoji: '🛒',
    lucideIcon: 'shopping-cart',
    color: '#2dd4bf', // Teal 400
    isIncome: false
  },
  'Trasporti': {
    emoji: '🚗',
    lucideIcon: 'car',
    color: '#60a5fa', // Blue 400
    isIncome: false
  },
  'Ristoranti': {
    emoji: '🍽️',
    lucideIcon: 'utensils',
    color: '#fb7185', // Rose 400
    isIncome: false
  },
  'Bollette': {
    emoji: '⚡',
    lucideIcon: 'zap',
    color: '#fbbf24', // Amber 400
    isIncome: false
  },
  'Shopping': {
    emoji: '🛍️',
    lucideIcon: 'shopping-bag',
    color: '#e879f9', // Fuchsia 400
    isIncome: false
  },
  'Casa': {
    emoji: '🏠',
    lucideIcon: 'home',
    color: '#a78bfa', // Violet 400
    isIncome: false
  },
  'Salute': {
    emoji: '💊',
    lucideIcon: 'pill',
    color: '#f43f5e', // Rose 500
    isIncome: false
  },
  'Intrattenimento': {
    emoji: '🎬',
    lucideIcon: 'film',
    color: '#38bdf8', // Sky 400
    isIncome: false
  },
  'Sport': {
    emoji: '⚽',
    lucideIcon: 'dumbbell',
    color: '#818cf8', // Indigo 400
    isIncome: false
  },
  'Educazione': {
    emoji: '📚',
    lucideIcon: 'book-open',
    color: '#4ade80', // Emerald 400
    isIncome: false
  },
  'Tecnologia': {
    emoji: '💻',
    lucideIcon: 'laptop',
    color: '#6366f1', // Indigo 500
    isIncome: false
  },
  'Benessere': {
    emoji: '💆',
    lucideIcon: 'scissors',
    color: '#fdba74', // Orange 300
    isIncome: false
  },
  'Acquisti Online': {
    emoji: '📦',
    lucideIcon: 'package',
    color: '#f97316', // Orange 500
    isIncome: false
  },
  'Viaggi': {
    emoji: '✈️',
    lucideIcon: 'plane',
    color: '#0ea5e9', // Sky 500
    isIncome: false
  },
  'Commissioni Bancarie': {
    emoji: '🏦',
    lucideIcon: 'landmark',
    color: '#4338ca', // Indigo 700
    isIncome: false
  },
  'Prelievi': {
    emoji: '🏧',
    lucideIcon: 'banknote',
    color: '#8b5cf6', // Violet 500
    isIncome: false
  },
  'Bonifico': {
    emoji: '💸',
    lucideIcon: 'credit-card',
    color: '#0ea5e9', // Sky 500
    isIncome: false
  },
  'Paghetta': {
    emoji: '👶',
    lucideIcon: 'baby',
    color: '#facc15', // Yellow 400
    isIncome: false
  },
  'Stipendio': {
    emoji: '💰',
    lucideIcon: 'coins',
    color: '#22c55e', // Green 500
    isIncome: true
  },
  'Entrate Varie': {
    emoji: '💰',
    lucideIcon: 'wallet',
    color: '#10b981', // Emerald 500
    isIncome: true
  },
  'Altre Spese': {
    emoji: '💸',
    lucideIcon: 'receipt',
    color: '#db2777', // Pink 600
    isIncome: false
  }
};

/**
 * Ritorna le metadati per una categoria data
 */
function getMetadata(category) {
  return CATEGORY_METADATA[category] || {
    emoji: '💸',
    lucideIcon: 'help-circle',
    color: '#f87171',
    isIncome: false
  };
}

module.exports = {
  CATEGORY_METADATA,
  getMetadata
};
