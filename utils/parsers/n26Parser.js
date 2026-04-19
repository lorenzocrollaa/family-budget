// utils/parsers/n26Parser.js
// Parser CSV per N26
// Formato: Export da "App N26 > Transazioni > Export .csv"
// Headers: "Date","Payee","Account number","Transaction type","Payment reference","Amount (EUR)","Amount (Foreign Currency)","Type Foreign Currency","Exchange Rate"

const BaseBankParser = require('./baseBankParser');

class N26Parser extends BaseBankParser {
  constructor() {
    super();
    this.bankName = 'N26';
  }

  canParse(content) {
    const text = content.toLowerCase();
    const indicators = ['n26', 'payee', 'payment reference', 'account number'];
    const score = indicators.filter(i => text.includes(i)).length;
    return Math.min(score * 0.28, 0.9);
  }

  /**
   * Mappa le colonne del CSV N26
   * Standard headers: Date, Payee, Account number, Transaction type, Payment reference, Amount (EUR)
   */
  parseCSVHeaders(headers) {
    const map = {};
    headers.forEach((h, i) => {
      const lower = h.toLowerCase().trim().replace(/['"]/g, '');
      if (['date', 'data'].includes(lower)) {
        map.date = i;
      } else if (['payee', 'beneficiario', 'destinatario'].includes(lower)) {
        map.description = i;
      } else if (lower.startsWith('amount') || lower.startsWith('importo')) {
        if (map.amount === undefined) map.amount = i; // Prende solo il primo (EUR)
      } else if (['payment reference', 'causale', 'riferimento'].includes(lower)) {
        map.reference = i;
      } else if (['transaction type', 'tipo transazione'].includes(lower)) {
        map.type = i;
      }
    });
    return map;
  }

  /**
   * Parse riga CSV N26
   */
  parseCSVRow(cols, map) {
    const dateStr = cols[map.date]?.trim();
    const payee = cols[map.description]?.trim() || '';
    const reference = map.reference !== undefined ? (cols[map.reference]?.trim() || '') : '';
    const amountStr = cols[map.amount]?.trim();

    const date = this.normalizeDate(dateStr);
    if (!date) return null;

    // N26: la descrizione migliore è: Payee + riferimento pagamento
    const desc = reference && reference !== payee
      ? `${payee} - ${reference}`
      : payee || 'Transazione N26';

    const amount = this.parseAmount(amountStr);
    if (isNaN(amount) || amount === 0) return null;

    return {
      date,
      description: this.cleanDescription(desc),
      amount,
      originalText: cols.join(','),
      confidence: 0.93
    };
  }

  /**
   * Parse testo PDF N26 (fallback)
   */
  parse(content) {
    const transactions = [];
    const lines = content.split('\n');

    const txRegex = /(\d{4}-\d{2}-\d{2})\s+(.{3,80}?)\s+([-+]?\d{1,6}[.,]\d{2})/;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length < 10) continue;

      const match = trimmed.match(txRegex);
      if (match) {
        const amount = this.parseAmount(match[3]);
        if (!isNaN(amount) && Math.abs(amount) > 0.01) {
          transactions.push({
            date: match[1],
            description: this.cleanDescription(match[2]),
            amount,
            originalText: trimmed,
            confidence: 0.82
          });
        }
      }
    }

    return this.postProcess(transactions);
  }
}

module.exports = N26Parser;
