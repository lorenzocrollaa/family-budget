// utils/parsers/intesaParser.js
// Parser PDF/CSV/Excel per Intesa Sanpaolo
// PDF: Estratto conto mensile
// Excel/CSV: Export da "Operazioni > Esporta"

const BaseBankParser = require('./baseBankParser');

class IntesaSanpaoloParser extends BaseBankParser {
  constructor() {
    super();
    this.bankName = 'Intesa Sanpaolo';
  }

  canParse(content) {
    const text = content.toLowerCase();
    const indicators = [
      'intesa sanpaolo',
      'intesa s.p.a',
      'isybank',
      'cassa di risparmio',
      'banca fideuram',
    ];
    const score = indicators.filter(i => text.includes(i)).length;
    return Math.min(score * 0.45, 0.95);
  }

  /**
   * Mappa le colonne del CSV/Excel Intesa Sanpaolo
   * Tipici headers: Data;Descrizione operazione;Accrediti;Addebiti;Descrizione aggiuntiva
   */
  parseCSVHeaders(headers) {
    const map = {};
    headers.forEach((h, i) => {
      const lower = h.toLowerCase().trim();
      // Data
      if (['data', 'data operazione', 'data movimento', 'data contabile', 'data valuta'].includes(lower)) {
        if (map.date === undefined) map.date = i;
      }
      // Descrizione
      else if (['descrizione operazione', 'descrizione', 'causale', 'note'].includes(lower)) {
        map.description = i;
      }
      // Importo separato in accrediti/addebiti
      else if (['accrediti', 'accredito', 'entrate', 'crediti'].includes(lower)) {
        map.income = i;
      }
      else if (['addebiti', 'addebito', 'uscite', 'debiti'].includes(lower)) {
        map.expense = i;
      }
      // Oppure importo unico con segno
      else if (['importo', 'amount', 'valore'].includes(lower)) {
        map.amount = i;
      }
    });
    return map;
  }

  /**
   * Parse riga CSV/Excel Intesa Sanpaolo
   */
  parseCSVRow(cols, map) {
    const dateStr = cols[map.date]?.trim();
    const descStr = cols[map.description]?.trim() || '';

    let amount = 0;
    if (map.amount !== undefined) {
      amount = this.parseAmount(cols[map.amount]);
    } else if (map.income !== undefined || map.expense !== undefined) {
      const income = this.parseAmount(cols[map.income] || '0');
      const expense = this.parseAmount(cols[map.expense] || '0');
      if (income > 0.01) amount = income;
      else if (expense > 0.01) amount = -Math.abs(expense);
    }

    const date = this.normalizeDate(dateStr);
    if (!date || !descStr || Math.abs(amount) < 0.01) return null;

    return {
      date,
      description: this.cleanDescription(descStr),
      amount,
      originalText: cols.join(';'),
      confidence: 0.91
    };
  }

  /**
   * Parse PDF Intesa Sanpaolo
   * Pattern PDF: "DD/MM/YYYY  DD/MM/YYYY  Descrizione  1.234,56"
   */
  parse(content) {
    const transactions = [];
    const lines = content.split('\n');

    // Pattern con doppia data (operazione + valuta) caratteristico di Intesa
    const doubleDate = /(\d{2}[\/\-]\d{2}[\/\-]\d{4})\s+\d{2}[\/\-]\d{2}[\/\-]\d{4}\s+(.{5,80}?)\s+([-+]?\d{1,6}[.,]\d{2})/;
    const singleDate = /(\d{2}[\/\-]\d{2}[\/\-]\d{4})\s+(.{5,80}?)\s+([-+]?\d{1,6}[.,]\d{2})\s*$/;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length < 15) continue;

      const match = trimmed.match(doubleDate) || trimmed.match(singleDate);
      if (match) {
        const date = this.normalizeDate(match[1]);
        const description = this.cleanDescription(match[2]);
        const amount = this.parseAmount(match[3]);

        if (date && description && !isNaN(amount) && Math.abs(amount) > 0.01) {
          // Ignora righe di saldo iniziale/finale
          const descLower = description.toLowerCase();
          if (descLower.includes('saldo iniziale') || descLower.includes('saldo finale')) continue;

          transactions.push({
            date,
            description,
            amount,
            originalText: trimmed,
            confidence: 0.87
          });
        }
      }
    }

    return this.postProcess(transactions);
  }
}

module.exports = IntesaSanpaoloParser;
