// utils/parsers/finecoParser.js
// Parser CSV/Excel per Fineco Bank
// Formato: Export da "Home Banking > Conto > Movimenti > Esporta"

const BaseBankParser = require('./baseBankParser');

class FinecoParser extends BaseBankParser {
  constructor() {
    super();
    this.bankName = 'Fineco Bank';
  }

  /**
   * Riconosce contenuto Fineco da testo PDF o intestazioni CSV
   */
  canParse(content) {
    const text = content.toLowerCase();
    const indicators = [
      'fineco',
      'finecobank',
      'fineco bank',
      'banca fineco',
    ];
    const score = indicators.filter(i => text.includes(i)).length;
    return Math.min(score * 0.35, 0.95);
  }

  /**
   * Parse generico headers CSV Fineco
   * Fineco CSV format (semicolon-separated):
   * Data;Entrate;Uscite;Descrizione;Stato
   */
  parseCSVHeaders(headers) {
    const map = {};
    headers.forEach((h, i) => {
      const lower = h.toLowerCase().trim();
      if (['data', 'data operazione', 'data contabile'].includes(lower)) {
        map.date = i;
      } else if (['entrate', 'accredito', 'credito', 'in'].includes(lower)) {
        map.income = i;
      } else if (['uscite', 'addebito', 'debito', 'out'].includes(lower)) {
        map.expense = i;
      } else if (['importo', 'amount', 'valore'].includes(lower)) {
        map.amount = i;
      } else if (['descrizione', 'description', 'causale', 'memo'].includes(lower)) {
        map.description = i;
      } else if (['stato'].includes(lower)) {
        map.state = i;
      }
    });
    return map;
  }

  /**
   * Parse riga CSV Fineco
   */
  parseCSVRow(cols, map) {
    const dateStr = cols[map.date]?.trim();
    const descStr = cols[map.description] ?? cols[1] ?? '';
    
    let amount = 0;
    if (map.amount !== undefined) {
      amount = this.parseAmount(cols[map.amount]);
    } else if (map.income !== undefined && map.expense !== undefined) {
      const income = this.parseAmount(cols[map.income] || '0');
      const expense = this.parseAmount(cols[map.expense] || '0');
      // Fineco ha entrate positive e uscite positive (serve negazione)
      amount = income > 0 ? income : -Math.abs(expense);
    }

    const date = this.normalizeDate(dateStr);
    if (!date || !descStr || amount === 0) return null;

    return {
      date,
      description: this.cleanDescription(descStr),
      amount,
      originalText: cols.join(';'),
      confidence: 0.92
    };
  }

  /**
   * Parse completo del testo PDF Fineco
   */
  parse(content) {
    const transactions = [];
    const lines = content.split('\n');

    // Regex Fineco PDF: DD/MM/YYYY ... amount
    const txRegex = /(\d{2}[\/\-]\d{2}[\/\-]\d{4})\s+(.{5,80}?)\s+([-+]?\d{1,6}[.,]\d{2})\s*$/;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length < 15) continue;

      const match = trimmed.match(txRegex);
      if (match) {
        const date = this.normalizeDate(match[1]);
        const description = this.cleanDescription(match[2]);
        const amount = this.parseAmount(match[3]);

        if (date && description && !isNaN(amount) && Math.abs(amount) > 0.01) {
          transactions.push({
            date,
            description,
            amount,
            originalText: trimmed,
            confidence: 0.85
          });
        }
      }
    }

    return this.postProcess(transactions);
  }
}

module.exports = FinecoParser;
