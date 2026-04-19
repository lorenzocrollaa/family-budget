// backend/utils/parsers/baseBankParser.js
// Classe base per tutti i parser bancari
const { intelligentNoiseRemoval } = require('../ultimateCategorizer');

class BaseBankParser {
  constructor() {
    this.bankName = 'Generic Bank';
    this.patterns = [];
    this.dateFormats = [];
  }

  /**
   * Identifica se questo parser può gestire il contenuto
   * @param {string} content - Contenuto del file
   * @returns {number} - Confidence score 0-1
   */
  canParse(content) {
    return 0;
  }

  /**
   * Parsing principale - DA IMPLEMENTARE nelle sottoclassi
   * @param {string} content - Contenuto del file
   * @returns {Array} - Array di transazioni
   */
  parse(content) {
    throw new Error('parse() must be implemented by subclass');
  }

  /**
   * Normalizza data in formato YYYY-MM-DD
   */
  normalizeDate(dateStr) {
    if (!dateStr) return null;
    
    const cleanDate = dateStr.toString().trim();
    
    // Timestamp
    if (/^\d{10,13}$/.test(cleanDate)) {
      const timestamp = parseInt(cleanDate);
      const date = new Date(timestamp > 10000000000 ? timestamp : timestamp * 1000);
      return date.toISOString().split('T')[0];
    }
    
    let match;
    
    // DD/MM/YYYY o DD-MM-YYYY o DD.MM.YYYY
    if ((match = cleanDate.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/))) {
      const [, day, month, year] = match;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    
    // YYYY/MM/DD
    if ((match = cleanDate.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/))) {
      const [, year, month, day] = match;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    
    // DD/MM/YY
    if ((match = cleanDate.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2})$/))) {
      const [, day, month, year] = match;
      const fullYear = parseInt(year) > 50 ? `19${year}` : `20${year}`;
      return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    // Formato testo italiano: "25 giugno" -> cerca anno nel contesto
    const monthsIT = {
      'gennaio': '01', 'febbraio': '02', 'marzo': '03', 'aprile': '04',
      'maggio': '05', 'giugno': '06', 'luglio': '07', 'agosto': '08',
      'settembre': '09', 'ottobre': '10', 'novembre': '11', 'dicembre': '12'
    };
    
    if ((match = cleanDate.match(/^(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)$/i))) {
      const [, day, monthName] = match;
      const month = monthsIT[monthName.toLowerCase()];
      const year = new Date().getFullYear(); // Usa anno corrente come fallback
      return `${year}-${month}-${day.padStart(2, '0')}`;
    }
    
    return null;
  }

  /**
   * Parse amount con gestione segni e formati europei
   */
  parseAmount(amountStr) {
    if (!amountStr) return 0;
    
    let cleanAmount = amountStr.toString().replace(/[€$£\s]/g, '');
    
    const isNegative = cleanAmount.includes('-') || 
                     (cleanAmount.includes('(') && cleanAmount.includes(')'));
    
    cleanAmount = cleanAmount.replace(/[-+()]/g, '');
    
    // Gestione formato europeo: 1.234,56 vs americano 1,234.56
    const lastComma = cleanAmount.lastIndexOf(',');
    const lastDot = cleanAmount.lastIndexOf('.');
    
    if (lastComma > lastDot) {
      // Formato europeo: 1.234,56
      cleanAmount = cleanAmount.replace(/\./g, '').replace(',', '.');
    } else if (lastDot > lastComma) {
      // Formato americano: 1,234.56
      cleanAmount = cleanAmount.replace(/,/g, '');
    }
    
    const amount = parseFloat(cleanAmount);
    return isNaN(amount) ? 0 : (isNegative ? -Math.abs(amount) : amount);
  }

  /**
   * Pulisce descrizione transazione
   */
  cleanDescription(description) {
    return intelligentNoiseRemoval(description);
  }

  /**
   * Helper per Title Case (Nomi Proprii più leggibili)
   */
  toTitleCase(str) {
    if (!str) return '';
    str = str.replace(/DICE\s+MBRE/gi, 'DICEMBRE').replace(/GENN\s+AIO/gi, 'GENNAIO');
    return str.toLowerCase().split(/\s+/).map(word => {
        if (word.length <= 3 && /^[a-z]+$/.test(word)) return word.toUpperCase();
        if (word.includes('&') || word.includes('+')) return word.toUpperCase();
        return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(' ');
  }

  /**
   * Valida transazione
   */
  isValidTransaction(transaction) {
    if (!transaction.date || !transaction.description || transaction.amount === undefined) {
      return false;
    }
    
    const date = new Date(transaction.date);
    if (isNaN(date.getTime())) {
      return false;
    }
    
    const amount = parseFloat(transaction.amount);
    if (isNaN(amount) || Math.abs(amount) < 0.01) {
      return false;
    }
    
    return true;
  }

  /**
   * Raggruppa transazioni correlate (es: pagamento + commissione)
   */
  groupRelatedTransactions(transactions) {
    const grouped = [];
    let i = 0;

    while (i < transactions.length) {
      const current = transactions[i];
      
      // Cerca commissioni successive
      const relatedCommissions = [];
      let j = i + 1;
      
      while (j < transactions.length && j < i + 3) {
        const next = transactions[j];
        
        // Se è una commissione dello stesso giorno e importo piccolo
        if (next.date === current.date && 
            Math.abs(next.amount) < 10 && 
            (next.description.toLowerCase().includes('commissione') ||
             next.description.toLowerCase().includes('spese'))) {
          relatedCommissions.push(next);
          j++;
        } else {
          break;
        }
      }

      if (relatedCommissions.length > 0) {
        // Unisci transazione principale con commissioni
        const totalAmount = current.amount + relatedCommissions.reduce((sum, c) => sum + c.amount, 0);
        grouped.push({
          ...current,
          amount: totalAmount,
          description: current.description,
          hasCommissions: true,
          commissionsDetail: relatedCommissions.map(c => `${c.description}: €${Math.abs(c.amount).toFixed(2)}`).join('; ')
        });
        i = j;
      } else {
        grouped.push(current);
        i++;
      }
    }

    return grouped;
  }

  /**
   * Post-processing delle transazioni
   */
  postProcess(transactions) {
    // ✅ RIMOSSA: La deduplicazione ora viene gestita in modo intelligente
    // nella rotta di upload tramite l'Occurrence Indexed Hash.
    // Qui manteniamo solo l'ordinamento.
    
    const processed = [...transactions];

    // Ordina per data (più recenti prima)
    processed.sort((a, b) => new Date(b.date) - new Date(a.date));

    return processed;
  }

  /**
   * Estrae anno dal contesto del documento
   */
  extractYearFromContext(content) {
    // Cerca pattern comuni per l'anno
    const yearPatterns = [
      /CONTO CORRENTE.*?(\d{4})/i,
      /ESTRATTO CONTO.*?(\d{4})/i,
      /PERIODO.*?(\d{4})/i,
      /AL\s+\d{1,2}[\/\-\.]\d{1,2}[\/\-\.](\d{4})/i,
      /DAL\s+\d{1,2}[\/\-\.]\d{1,2}[\/\-\.](\d{4})/i,
      /del\s+\d{1,2}\/\d{1,2}\/(\d{4})/i
    ];

    for (const pattern of yearPatterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        const year = parseInt(match[1]);
        if (year >= 2000 && year <= 2030) {
          return year;
        }
      }
    }

    return new Date().getFullYear();
  }

  /**
   * Logging helper
   */
  log(message, data = null) {
    console.log(`[${this.bankName}] ${message}`, data || '');
  }

  /**
   * Error helper
   */
  error(message, error = null) {
    console.error(`[${this.bankName}] ERROR: ${message}`, error || '');
  }
}

module.exports = BaseBankParser;