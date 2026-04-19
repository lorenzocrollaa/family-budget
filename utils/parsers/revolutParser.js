// utils/parsers/revolutParser.js
// Parser CSV per Revolut
// Formato: Export da "Profilo > Estratto conto > Formato CSV"
// Formato Excel: Revolut - Statement.xlsx

const BaseBankParser = require('./baseBankParser');

class RevolutParser extends BaseBankParser {
  constructor() {
    super();
    this.bankName = 'Revolut';
  }

  canParse(content) {
    const text = content.toLowerCase();
    const indicators = ['revolut', 'completed', 'pending', 'exchange', 'currency'];
    const score = indicators.filter(i => text.includes(i)).length;
    return Math.min(score * 0.22, 0.9);
  }

  /**
   * Mappa le colonne del CSV Revolut
   * Standard headers: Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
   */
  parseCSVHeaders(headers) {
    const map = {};
    headers.forEach((h, i) => {
      const lower = h.toLowerCase().trim();
      if (['completed date', 'data completamento', 'started date'].includes(lower)) {
        if (map.date === undefined) map.date = i; // Preferisce completed date
      } else if (['description', 'descrizione', 'merchant'].includes(lower)) {
        map.description = i;
      } else if (['amount', 'importo'].includes(lower)) {
        map.amount = i;
      } else if (['currency', 'valuta'].includes(lower)) {
        map.currency = i;
      } else if (['fee', 'commissione'].includes(lower)) {
        map.fee = i;
      } else if (['state', 'stato', 'status'].includes(lower)) {
        map.state = i;
      } else if (['type', 'tipo'].includes(lower)) {
        map.type = i;
      }
    });
    return map;
  }

  /**
   * Parse riga CSV Revolut
   * Filtra le transazioni "DECLINED" o "REVERTED"
   */
  parseCSVRow(cols, map) {
    // Salta transazioni non completate
    if (map.state !== undefined) {
      const state = (cols[map.state] || '').toLowerCase().trim();
      if (['failed', 'declined', 'reverted'].includes(state)) return null;
    }

    const dateStr = cols[map.date]?.trim();
    const descStr = cols[map.description]?.trim() || 'Transazione Revolut';
    const amountStr = cols[map.amount]?.trim();
    const currency = cols[map.currency]?.trim() || 'EUR';

    const date = this.normalizeDate(dateStr);
    if (!date) return null;

    let amount = this.parseAmount(amountStr);
    if (isNaN(amount) || amount === 0) return null;

    // Aggiungi suffix valuta se non EUR
    const desc = currency !== 'EUR'
      ? `${descStr} (${currency})`
      : descStr;

    return {
      date,
      description: this.cleanDescription(desc),
      amount,
      originalText: cols.join(','),
      confidence: 0.93
    };
  }

  /**
   * Parse testo contenuto Revolut (fallback da PDF)
   */
  parse(content) {
    const transactions = [];
    const lines = content.split('\n');

    // Pattern date tipico Revolut: "Jan 15, 2024" o "2024-01-15"
    const isoDateRegex = /(\d{4}-\d{2}-\d{2})[T\s]([0-9:]+)?/;
    const txRegex = /(\d{4}-\d{2}-\d{2})\s+(.{3,60}?)\s+([-+]?\d{1,6}[.,]\d{2})\s*(EUR|USD|GBP)?/i;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length < 10) continue;

      const match = trimmed.match(txRegex);
      if (match) {
        const amount = this.parseAmount(match[3]);
        if (!isNaN(amount) && Math.abs(amount) > 0.01) {
          const desc = match[4] ? `${match[2]} (${match[4]})` : match[2];
          transactions.push({
            date: match[1],
            description: this.cleanDescription(desc),
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

module.exports = RevolutParser;
