// backend/utils/parsers/genericPDFParser.js
// Parser generico migliorato per PDF bancari di qualsiasi banca

const BaseBankParser = require('./baseBankParser');

class GenericPDFParser extends BaseBankParser {
  constructor() {
    super();
    this.bankName = 'Generic PDF';
  }

  /**
   * Parser generico - sempre disponibile come fallback
   */
  canParse(content) {
    // Parser generico ha sempre confidence bassa (0.3)
    // Sarà usato solo se nessun altro parser ha confidence maggiore
    return 0.3;
  }

  /**
   * Parsing generico multi-pattern
   */
  parse(content) {
    this.log('Inizio parsing generico PDF');
    
    const lines = content.split('\n');
    const transactions = [];

    // Prova diversi pattern comuni
    const patterns = this.getTransactionPatterns();

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length < 10) continue;

      for (const pattern of patterns) {
        const transaction = this.tryPattern(trimmed, pattern);
        if (transaction) {
          transactions.push(transaction);
          break; // Pattern trovato, passa alla prossima riga
        }
      }
    }

    this.log(`Transazioni estratte: ${transactions.length}`);

    if (transactions.length === 0) {
      this.log('Nessuna transazione trovata con pattern generici');
      return [];
    }

    // Post-processing
    return this.postProcess(transactions);
  }

  /**
   * Pattern comuni per estratti conto italiani
   */
  getTransactionPatterns() {
    return [
      // Pattern 1: DD/MM/YYYY Descrizione -123,45 €
      {
        name: 'DateDescAmount',
        regex: /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+([-+]?€?\s*\d{1,6}[.,]\d{2})\s*€?\s*$/,
        groups: { date: 1, description: 2, amount: 3 }
      },

      // Pattern 2: DD-MM-YYYY Descrizione 123,45 D/A
      {
        name: 'DateDescAmountDA',
        regex: /^(\d{2}[-\/]\d{2}[-\/]\d{4})\s+(.+?)\s+(\d{1,6}[.,]\d{2})\s+([DA])\s*$/,
        groups: { date: 1, description: 2, amount: 3, sign: 4 }
      },

      // Pattern 3: DD/MM/YYYY | Descrizione | ±123.45
      {
        name: 'PipeSeparated',
        regex: /^(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})\s*\|\s*(.+?)\s*\|\s*([-+]?\d{1,6}[.,]\d{2})/,
        groups: { date: 1, description: 2, amount: 3 }
      },

      // Pattern 4: DD/MM/YYYY Descrizione EUR 123,45
      {
        name: 'WithCurrency',
        regex: /^(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})\s+(.+?)\s+(EUR|USD|GBP)\s+([-+]?\d{1,6}[.,]\d{2})/,
        groups: { date: 1, description: 2, amount: 4 }
      },

      // Pattern 5: Tabellare con spazi multipli
      {
        name: 'MultiSpaces',
        regex: /^(\d{2}[\/\-]\d{2}[\/\-]\d{4})\s{2,}(.+?)\s{2,}([-+]?\d{1,6}[.,]\d{2})\s*€?\s*$/,
        groups: { date: 1, description: 2, amount: 3 }
      },

      // Pattern 6: Con valuta dopo importo
      {
        name: 'CurrencyAfter',
        regex: /^(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})\s+(.+?)\s+([-+]?\d{1,6}[.,]\d{2})\s+(EUR|€)/,
        groups: { date: 1, description: 2, amount: 3 }
      },

      // Pattern 7: Descrizione lunga con data alla fine
      {
        name: 'DescDateAmount',
        regex: /^(.+?)\s+(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})\s+([-+]?\d{1,6}[.,]\d{2})\s*€?\s*$/,
        groups: { description: 1, date: 2, amount: 3 }
      },

      // Pattern 8: Formato YYYY-MM-DD (ISO)
      {
        name: 'ISODate',
        regex: /^(\d{4}[-\/]\d{2}[-\/]\d{2})\s+(.+?)\s+([-+]?\d{1,6}[.,]\d{2})\s*€?\s*$/,
        groups: { date: 1, description: 2, amount: 3 }
      },

      // Pattern 9: Con balance/saldo finale
      {
        name: 'WithBalance',
        regex: /^(\d{2}[\/\-]\d{2}[\/\-]\d{4})\s+(.+?)\s+([-+]?\d{1,6}[.,]\d{2})\s+([-+]?\d{1,6}[.,]\d{2})\s*$/,
        groups: { date: 1, description: 2, amount: 3, balance: 4 }
      },

      // Pattern 10: Bonifico con causale
      {
        name: 'Bonifico',
        regex: /^(\d{2}[\/\-]\d{2}[\/\-]\d{4})\s+(BONIF|BON|TRF|TRANSFER).+?([+-]?\d{1,6}[.,]\d{2})\s*€?\s*$/i,
        groups: { date: 1, description: 0, amount: 3 }
      }
    ];
  }

  /**
   * Tenta di estrarre transazione con un pattern specifico
   */
  tryPattern(line, pattern) {
    const match = line.match(pattern.regex);
    if (!match) return null;

    try {
      // Estrai componenti secondo il pattern
      let date = match[pattern.groups.date];
      let description = pattern.groups.description === 0 ? match[0] : match[pattern.groups.description];
      let amount = match[pattern.groups.amount];
      let sign = pattern.groups.sign ? match[pattern.groups.sign] : null;

      // Normalizza data
      date = this.normalizeDate(date);
      if (!date) return null;

      // Parse amount
      amount = this.parseAmount(amount);

      // Applica segno D/A se presente
      if (sign === 'D') amount = -Math.abs(amount);
      else if (sign === 'A') amount = Math.abs(amount);

      // Pulisci descrizione
      description = this.cleanDescription(description);

      // Validazione base
      if (!description || Math.abs(amount) < 0.01) return null;

      return {
        date,
        description,
        amount,
        originalText: line,
        confidence: 0.7,
        pattern: pattern.name
      };

    } catch (e) {
      return null;
    }
  }

  /**
   * Rileva formato banca da header
   */
  detectBankFromContent(content) {
    const bankPatterns = {
      'Intesa Sanpaolo': /INTESA\s*SANPAOLO|ISP/i,
      'UniCredit': /UNICREDIT|UNCRIT/i,
      'BNL': /BNL|BANCA\s*NAZIONALE/i,
      'Poste Italiane': /POSTE\s*ITALIANE|BANCOPOSTA/i,
      'Banco BPM': /BANCO\s*BPM|BPM/i,
      'BPER': /BPER/i,
      'Mediolanum': /MEDIOLANUM/i,
      'Fineco': /FINECO/i,
      'ING': /ING\s*DIRECT|ING\s*BANK/i,
      'N26': /N26/i,
      'Revolut': /REVOLUT/i
    };

    for (const [bank, pattern] of Object.entries(bankPatterns)) {
      if (pattern.test(content)) {
        this.log(`Banca rilevata dal contenuto: ${bank}`);
        return bank;
      }
    }

    return 'Unknown Bank';
  }

  /**
   * Override post-processing per inferire info aggiuntive
   */
  postProcess(transactions) {
    // Deduplica base
    const unique = super.postProcess(transactions);

    // Arricchisci con info aggiuntive se possibile
    return unique.map(t => ({
      ...t,
      isIncome: t.amount > 0,
      isExpense: t.amount < 0,
      absAmount: Math.abs(t.amount)
    }));
  }
}

module.exports = GenericPDFParser;