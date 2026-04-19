// utils/parsers/unicreditParser.js
// Parser specializzato per estratti conto UniCredit / BuddyBank
//
// STRUTTURA REALE DEL PDF (4 righe per transazione):
//
// RIGA 1: "DD.MM.YY   DD.MM.YY"                  ← Data contabile + Data valuta
// RIGA 2: "TIPOLOGIA OPERAZIONE..."               ← Tipo: PAGAMENTO, BONIFICO A VOSTRO FAVORE, DISPOSIZIONE DI BONIFICO
// RIGA 3: "CARTA *0019 DI EUR 3,50 MERCHANT CITY" ← Dettaglio (può essere su 2 righe per bonifici)
// RIGA N: "3,50"                                  ← Importo standalone (solo numero, ultima riga del blocco)
//
// SEGNO:
// - "BONIFICO A VOSTRO FAVORE" → ENTRATA (positivo)
// - Tutto il resto (PAGAMENTO, DISPOSIZIONE DI BONIFICO) → USCITA (negativo)

const BaseBankParser = require('./baseBankParser');

class UniCreditParser extends BaseBankParser {
  constructor() {
    super();
    this.bankName = 'UniCredit';
    
    this.identificationPatterns = [
      /UNICREDIT/i,
      /Codice BIC SWIFT:\s*UNCRIT/i,
      /IBAN\s+IT\s+\d{2}\s+[A-Z]\s+02008/i,
      /buddyunicredit/i,
      /BUDDY\s+BRANCH/i
    ];
  }

  canParse(content) {
    let score = 0;
    for (const pattern of this.identificationPatterns) {
      if (pattern.test(content)) score += 0.35;
    }
    if (/buddybank|buddy unicredit/i.test(content)) score += 0.5;
    if (/PAGAMENTO APPLE PAY MASTERCARD/i.test(content)) score += 0.3;
    if (/ELENCO\s+MOVIMENTI/i.test(content)) score += 0.2;
    return Math.min(score, 1.0);
  }

  parse(content) {
    this.log('Inizio parsing UniCredit/Buddybank PDF');
    
    // Determina se il contenuto ha coordinate [x] (formato dal backend fileParser.js)
    const hasCoordinates = /\[\d+\]/.test(content);
    
    if (hasCoordinates) {
      return this.parseWithCoordinates(content);
    } else {
      // Formato testo pulito (es. test diretti con pdf-parse standard)
      return this.parseUniCreditFormat(content);
    }
  }

  /**
   * Parser per formato con coordinate pixel iniettate dal fileParser.js pagerender.
   * 
   * In questo formato, ogni riga può contenere multipli elementi con coordinate:
   *   "[47]01.10.25   29.09.25 [478]3,50"    ← DATA + IMPORTO sulla stessa riga
   *   "[127]CARTA *0019 DI EUR 3,50 BAR..."  ← DESCRIZIONE su riga separata
   *   "[127]PAGAMENTO APPLE PAY..."           ← TIPO OPERAZIONE
   * 
   * La colonna X distingue:
   *   ~47:  Date (contabile + valuta)  
   *   ~127: Descrizioni
   *   ~469: Importo Uscite
   *   ~529: Importo Entrate
   */
  parseWithCoordinates(content) {
    this.log('Modalità parsing con coordinate pixel');
    const lines = content.split('\n');
    const transactions = [];
    let txCounter = 0;

    // Regex date nel formato DD.MM.YY o DD.MM.YYYY
    const datePattern = /^(\d{2}\.\d{2}\.\d{2,4})\s+(\d{2}\.\d{2}\.\d{2,4})/;
    
    // Parse di ogni riga in elementi con coordinata
    const parsedLines = lines.map(rawLine => {
      const elements = [];
      const regex = /\[(\d+)\]([^\[]*)/g;
      let m;
      while ((m = regex.exec(rawLine)) !== null) {
        const x = parseInt(m[1]);
        const text = m[2].trim();
        if (text) elements.push({ x, text });
      }
      return elements;
    });

    // Punto X di separazione tra colonna Uscite (~469) e Entrate (~529)
    const midpoint = 499;

    for (let i = 0; i < parsedLines.length; i++) {
      const elements = parsedLines[i];
      
      // Riga data: ha un elemento con X basso (~47) che contiene "DD.MM.YY  DD.MM.YY"
      const dateEl = elements.find(el => el.x < 90 && datePattern.test(el.text));
      if (!dateEl) continue;

      const dateMatch = dateEl.text.match(datePattern);
      const dateContabile = dateMatch[1];

      // Importo: elemento con X > 400 sulla stessa riga della data
      const amountEl = elements.find(el => el.x > 400 && /^\d{1,3}(?:\.\d{3})*,\d{2}$/.test(el.text));
      if (!amountEl) continue;

      const amountValue = this.parseItalianAmount(amountEl.text);
      if (isNaN(amountValue) || amountValue === 0) continue;
      
      // Segno: colonna < midpoint = Uscita, >= midpoint = Entrata
      const isIncome = amountEl.x >= midpoint;
      const finalAmount = isIncome ? Math.abs(amountValue) : -Math.abs(amountValue);

      // ────────────────────────────────────────────────────────────────────────
      // DESCRIZIONE: ci sono due strutture possibili in UniCredit:
      //
      // STRUTTURA A (Carta / Pagamento):
      //   L[i-1]: [127]PAGAMENTO APPLE PAY...      ← tipo (riga precedente)
      //   L[i]:   [47]DATA [469]importo            ← solo data + importo
      //   L[i+1]: [127]CARTA *0019 DI EUR...       ← descrizione (riga successiva)
      //
      // STRUTTURA B (Bonifico):
      //   L[i-1]: [127]DISPOSIZIONE DI BONIFICO    ← tipo (riga precedente)
      //   L[i]:   [47]DATA [127]BONIFICO ISTANT... [469]importo  ← data + desc + importo
      //   L[i+1]: [127]Causale TRN: ...            ← continuazione descrizione
      //
      // Il discriminante è la presenza di un [127] sulla stessa riga della data.
      // ────────────────────────────────────────────────────────────────────────

      // Check early: riga precedente = "COMMISSIONE PER OPERAZIONE IN VALUTA" → uscita tecnica
      let prevTipoText = '';
      if (i > 0) {
        const prevEls = parsedLines[i - 1];
        const tipoEl = prevEls?.find(el => el.x > 100 && el.text.length > 5);
        if (tipoEl) prevTipoText = tipoEl.text;
      }

      if (/COMMISSIONE\s+PER\s+OPERAZIONE\s+IN\s+VALUTA/i.test(prevTipoText)) {
        transactions.push({
          date: this.normalizeDate(dateContabile),
          description: 'Commissione Valuta Estera',
          amount: finalAmount,
          originalText: `${dateContabile} Commissione Valuta Estera [#${++txCounter}]`,
          confidence: 1.0,
          bank: 'UniCredit'
        });
        continue;
      }

      // Cerca descrizione inline sulla riga della data (struttura B - Bonifici)
      const inlineDescEl = elements.find(el => el.x > 90 && el.x < 400 && el.text.length > 5);

      let fullDesc = '';

      if (inlineDescEl) {
        // STRUTTURA B: Bonifico — la descrizione principale è sulla riga data
        // Tipo (riga precedente) + desc inline + continuazione (riga successiva)
        let tipoDesc = '';
        if (i > 0) {
          const prevEls = parsedLines[i - 1];
          const tipoEl = prevEls?.find(el => el.x > 100 && el.text.length > 5 && !this.isBoilerplateLine(el.text));
          if (tipoEl) tipoDesc = tipoEl.text;
        }

        let continuazione = '';
        if (i + 1 < parsedLines.length) {
          const nextEls = parsedLines[i + 1];
          const isNextDate = nextEls?.some(el => el.x < 90 && datePattern.test(el.text));
          if (!isNextDate) {
            const contEl = nextEls?.find(el => el.x > 100 && el.text.length > 3 && !this.isBoilerplateLine(el.text));
            if (contEl) continuazione = contEl.text;
          }
        }

        const parts = [tipoDesc, inlineDescEl.text, continuazione].filter(p => p.length > 0);
        fullDesc = parts.join(' ').trim();

      } else {
        // STRUTTURA A: Carta — tipo prima, descrizione CARTA dopo
        let tipoDesc = '';
        if (i > 0) {
          const prevEls = parsedLines[i - 1];
          const tipoEl = prevEls?.find(el => el.x > 100 && el.text.length > 5 && !this.isBoilerplateLine(el.text));
          if (tipoEl) tipoDesc = tipoEl.text;
        }

        let cartaDesc = '';
        if (i + 1 < parsedLines.length) {
          const nextEls = parsedLines[i + 1];
          const isNextDate = nextEls?.some(el => el.x < 90 && datePattern.test(el.text));
          if (!isNextDate) {
            const cartaEl = nextEls?.find(el => el.x > 100 && el.text.length > 5 && !this.isBoilerplateLine(el.text));
            if (cartaEl) cartaDesc = cartaEl.text;
          }
        }

        // Se la riga CARTA contiene "COMMISSIONE PER" → è una commissione valuta estera
        if (/COMMISSIONE\s+PER\s+OPERAZIONE/i.test(cartaDesc)) {
          transactions.push({
            date: this.normalizeDate(dateContabile),
            description: 'Commissione Valuta Estera',
            amount: finalAmount,
            originalText: `${dateContabile} Commissione Valuta Estera [#${++txCounter}]`,
            confidence: 1.0,
            bank: 'UniCredit'
          });
          continue;
        }

        const parts = [tipoDesc, cartaDesc].filter(p => p.length > 0);
        fullDesc = parts.join(' ').trim();
      }

      if (!fullDesc) continue;

      const cleanDesc = this.extractCleanDescription(fullDesc);
      txCounter++;
      
      transactions.push({
        date: this.normalizeDate(dateContabile),
        description: cleanDesc,
        amount: finalAmount,
        originalText: `${dateContabile} ${fullDesc} [#${txCounter}]`,
        confidence: 1.0,
        bank: 'UniCredit'
      });
    }

    this.log(`Parsed ${transactions.length} UniCredit transactions (coordinate mode)`);
    return this.postProcess(transactions);
  }

  /**
   * Parser principale basato sulla struttura reale UniCredit:
   * 
   * BLOCCO ENTRATA (BONIFICO RICEVUTO):
   *   RIGA 1: "03.11.25   01.11.25"
   *   RIGA 2: "BONIFICO A VOSTRO FAVORE"
   *   RIGA 3..N-1: descrizione (può continuare su più righe)
   *   RIGA N: "150,00"  ← solo numero
   * 
   * BLOCCO USCITA (CARTA):
   *   RIGA 1: "01.10.25   29.09.25"
   *   RIGA 2: "PAGAMENTO APPLE PAY MASTERCARD NFC del 29/09/2025"
   *   RIGA 3: "CARTA *0019 DI EUR 3,50 BAR TABACCHI - RISTORA ROMA"
   *   RIGA 4: "3,50"
   * 
   * BLOCCO USCITA (BONIFICO INVIATO):
   *   RIGA 1: "15.07.25   15.07.25"
   *   RIGA 2: "DISPOSIZIONE DI BONIFICO"
   *   RIGA 3: "BONIFICO ISTANTANEO DEL... A: Nome PER: Causale TRN:..."
   *   RIGA 4: "220,00"
   */
  parseUniCreditFormat(content) {
    const lines = content.split('\n');
    const transactions = [];
    let txCounter = 0;

    // Regex per riconoscere la riga data (es. "01.10.25   29.09.25" o "01.10.2025   29.09.2025")
    const dateLineRegex = /^(\d{2}\.\d{2}\.\d{2,4})\s{2,}(\d{2}\.\d{2}\.\d{2,4})\s*$/;
    
    // Regex per riconoscere una riga che è SOLO un importo
    const amountOnlyRegex = /^(\d{1,3}(?:\.\d{3})*,\d{2})$/;

    // Skippa tutto quello che viene prima di "ELENCO MOVIMENTI"
    let startIdx = 0;
    for (let i = 0; i < lines.length; i++) {
      if (/ELENCO\s+MOVIMENTI|ELENCO\s+OPERAZIONI/i.test(lines[i])) {
        startIdx = i + 1;
        break;
      }
    }

    let i = startIdx;
    while (i < lines.length) {
      const line = lines[i].trim();

      // Skip righe vuote, header di pagina, boilerplate legale
      if (!line) { i++; continue; }
      if (this.isBoilerplateLine(line)) { i++; continue; }
      if (/^SALDO\s+INIZIALE/i.test(line) || /^SALDO\s+FINALE/i.test(line)) { i++; continue; }
      if (/^Data\s+Valuta\s+Descrizione/i.test(line) || /^DataValuta/i.test(line)) { i++; continue; }
      if (/^Estratto\s+conto\s+al/i.test(line)) { i++; continue; }
      if (/^\d{2}\.\d{2}\.\d{4}$/.test(line)) { i++; continue; } // es. "31.12.2025" standalone

      const dateMatch = line.match(dateLineRegex);
      if (!dateMatch) { i++; continue; }

      // Trovata una riga data → raccogliamo le righe del blocco transazione
      const dateContabile = dateMatch[1];
      i++; // vai alla riga 2 (tipo operazione)

      // Raccogliamo tutte le righe fino all'importo standalone
      const blockLines = [];
      while (i < lines.length) {
        const blockLine = lines[i].trim();

        // Stop se troviamo la prossima data → non dobbiamo consumarla
        if (dateLineRegex.test(blockLine)) break;
        // Stop su boilerplate
        if (this.isBoilerplateLine(blockLine)) { i++; continue; }
        // Skip header di pagina ripetuti
        if (/^Data\s+Valuta\s+Descrizione/i.test(blockLine) || /^DataValuta/i.test(blockLine)) { i++; continue; }
        if (/^Estratto\s+conto\s+al/i.test(blockLine)) { i++; continue; }
        if (/^\d{2}\.\d{2}\.\d{4}$/.test(blockLine)) { i++; continue; }
        if (!blockLine) { i++; continue; }

        blockLines.push(blockLine);

        // Se questa riga è un importo standalone → fine del blocco
        if (amountOnlyRegex.test(blockLine)) {
          i++;
          break;
        }
        i++;
      }

      if (blockLines.length === 0) continue;

      // L'ultima riga dovrebbe essere l'importo
      const lastLine = blockLines[blockLines.length - 1];
      const amountMatch = lastLine.match(amountOnlyRegex);
      
      if (!amountMatch) {
        // No importo trovato, skippa
        continue;
      }

      const amountRaw = amountMatch[1];
      const descLines = blockLines.slice(0, blockLines.length - 1); // tutto tranne l'importo
      const fullDesc = descLines.join(' ').trim();

      if (!fullDesc) continue;

      // Determina il segno: BONIFICO A VOSTRO FAVORE = entrata, tutto il resto = uscita
      const isIncome = /BONIFICO\s+A\s+VOSTRO\s+FAVORE/i.test(fullDesc);
      
      const amountValue = this.parseItalianAmount(amountRaw);
      if (isNaN(amountValue) || amountValue === 0) continue;

      const finalAmount = isIncome ? Math.abs(amountValue) : -Math.abs(amountValue);
      const cleanDesc = this.extractCleanDescription(fullDesc);

      txCounter++;
      transactions.push({
        date: this.normalizeDate(dateContabile),
        description: cleanDesc,
        amount: finalAmount,
        originalText: `${dateContabile} ${fullDesc} [#${txCounter}]`,
        confidence: 1.0,
        bank: 'UniCredit'
      });
    }

    this.log(`Parsed ${transactions.length} UniCredit transactions`);
    return this.postProcess(transactions);
  }

  /**
   * Righe boilerplate da ignorare
   */
  isBoilerplateLine(line) {
    return (
      /UniCredit\s+SpA\s*-\s*Sede\s+Sociale/i.test(line) ||
      /Piazza\s+Gae\s+Aulenti/i.test(line) ||
      /Albo\s+delle\s+Banche/i.test(line) ||
      /Fondo\s+Interbancario/i.test(line) ||
      /Imposta\s+di\s+bollo/i.test(line) ||
      /LCC0EC/i.test(line) ||
      /Elenco\s+n\.\s+\d+\s+Pagina/i.test(line) ||
      /RIEPILOGO\s+GENERALE/i.test(line) ||
      /Saldo\s+iniziale\s+al\s+\d/i.test(line) ||
      /ELENCO\s+MOVIMENTI/i.test(line) ||
      /www\.buddyunicredit/i.test(line) ||
      /Per\s+il\s+blocco\s+delle/i.test(line) ||
      /800\.29\.09\.15/i.test(line) ||
      /Numero\s+Verde/i.test(line) ||
      /premibin\s+APP/i.test(line) ||
      /chatta\s+con\s+noi/i.test(line) ||
      /Ciao\s+Lorenzo/i.test(line) ||
      /ti\s+inviamo\s+l'estratto/i.test(line) ||
      /Riepilogo\s+delle\s+Spese/i.test(line) ||
      /Guida\s+sulle\s+operazioni/i.test(line) ||
      /BUDDY\s+BRANCH/i.test(line) ||
      /Codice\s+BIC\s+SWIFT/i.test(line) ||
      /Conto\s+Corrente:/i.test(line) ||
      /Uscite\s+Entrate/i.test(line) ||
      /\d{3}(?:,\d{2})?\s+\d{1,3}(?:\.\d{3})*,\d{2}\s+\d{1,3}(?:\.\d{3})*,\d{2}\s+\d{1,3}(?:\.\d{3})*,\d{2}/.test(line) // riga totali
    );
  }

  /**
   * Converte importo italiano "1.234,56" → 1234.56
   */
  parseItalianAmount(str) {
    if (!str) return NaN;
    return parseFloat(str.replace(/\./g, '').replace(',', '.'));
  }

  /**
   * Estrae la descrizione pulita e leggibile dalla descrizione raw.
   */
  extractCleanDescription(rawDesc) {
    // PRE-PROCESSING: rimuovi rumore da righe adiacenti che può essersi mescolato
    let desc = rawDesc
      // Rimuovi "Roma/Milano/ecc. Bonifico a Vostro Favore" (riga CARTA precedente che finisce col tipo della prossima)
      .replace(/\s+(?:ROMA|MILANO|NAPOLI|TORINO|FIRENZE|BOLOGNA|VENEZIA|PALERMO|GENOVA|LECCO|BARCELONA|MADRID|AMSTERDAM|BOSTON|CORK|DUBLIN|BERLIN|VIENNA)\s+Bonifico a Vostro Favore.*/i, '')
      .replace(/\s+Bonifico a Vostro Favore\s*$/i, '')
      .replace(/\s+DISPOSIZIONE DI Bonifico\s*$/i, '')
      // Rimuovi "Commissioni - Provvigioni - Spese" che è il tipo di una tx adiacente
      .replace(/\s+Commissioni\s*-\s*Provvigioni\s*-\s*Spese.*/i, '')
      // Rimuovi "Pagamento Apple Pay Mastercard..." che è il tipo della prossima tx
      .replace(/\s+Pagamento\s+(?:Apple\s+Pay\s+)?Mastercard(?:\s+(?:NFC|E-Commerce))?.*$/i, '')
      .replace(/\s+Pagamento\s+Mastercard.*$/i, '')
      .trim();
    
    const upper = desc.toUpperCase();

    // ─── COMMISSIONI VALUTA ESTERA ────────────────────────────────────────────
    if (/COMMISSIONE\s+PER\s+OPERAZIONE\s+IN\s+VALUTA/i.test(desc)) {
      return 'Commissione Valuta Estera';
    }
    if (/COMMISSIONI\s*-\s*PROVVIGIONI/i.test(desc)) {
      return 'Commissioni Bancarie';
    }

    // ─── CARTA / PAGAMENTO ───────────────────────────────────────────────────
    if (/PAGAMENTO|CARTA\s*\*/.test(upper)) {
      const cartaMatch = desc.match(/CARTA\s+\*\d+\s+DI\s+[A-Z]{3}\s+[\d,]+\s*(.+)/i);
      if (cartaMatch) {
        let merchant = cartaMatch[1].trim();
        merchant = this.cleanMerchantName(merchant);
        return this.toTitleCase(merchant) || 'Pagamento Carta';
      }
      return 'Pagamento Carta';
    }

    // ─── BONIFICO IN ENTRATA (A VOSTRO FAVORE o ISTANTANEO SENZA DA:) ────────
    if (/BONIFICO\s+A\s+VOSTRO\s+FAVORE/i.test(desc) || 
        (/BONIFICO\s+(?:ISTANTANEO|SEPA)/i.test(desc) && /DA:/i.test(desc))) {
      return this.extractBonificoDescription(desc, 'entrata');
    }

    // ─── BONIFICO IN USCITA (DISPOSIZIONE o ISTANTANEO CON A:) ───────────────
    if (/DISPOSIZIONE\s+DI\s+BONIFICO/i.test(desc) ||
        (/BONIFICO\s+(?:ISTANTANEO|SEPA)/i.test(desc) && /\bA:/i.test(desc))) {
      return this.extractBonificoDescription(desc, 'uscita');
    }

    // ─── FALLBACK BONIFICO (qualsiasi testo con "BONIFICO") ──────────────────
    if (/BONIFICO/i.test(upper)) {
      return this.extractBonificoDescription(desc, 'entrata');
    }

    // ─── COMMISSIONI / SPESE ─────────────────────────────────────────────────
    if (/COMMISSIONI/i.test(upper)) return 'Commissioni Bancarie';
    if (/SPESE\s+DI\s+TENUTA/i.test(upper)) return 'Spese di Tenuta Conto';
    if (/CANONE/i.test(upper)) return 'Canone Bancario';

    // ─── FALLBACK ─────────────────────────────────────────────────────────────
    return this.toTitleCase(rawDesc.substring(0, 50));
  }

  /**
   * Pulisce il nome del commerciante da rumore tecnico e geografico.
   */
  cleanMerchantName(merchant) {
    return merchant
      // Rimuovi prefissi importo valuta locale
      .replace(/^[\.,]?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}\s+/, '')
      // Rimuovi orari e date se presenti nel nome
      .replace(/\d{2}[.:]\d{2}(?:[.:]\d{2,4})?/g, '')
      .replace(/\d{2}\/\d{2}\/\d{2,4}/g, '')
      // Rimuovi simboli di valuta seguiti da numeri
      .replace(/\s+[£$€]\s*[\d,\.]+/g, '')
      // Rimuovi spazi extra
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Estrae causale da un bonifico (in entrata o uscita).
   * 
   * Formato: "BONIFICO ISTANTANEO DEL DD.MM.YYYY ALLE HH.MM.SS DA: NOME PER: Causale TRN: ... COMM: ..."
   * Oppure:  "BONIFICO SEPA DA: NOME PER: Causale COMM: 0,00 SPESE: ..."
   */
  extractBonificoDescription(rawDesc, direction) {
    // 1. Prova a trovare la causale (dopo "PER:"), deve essere sensata (non un TRN o vuota)
    const perMatch = rawDesc.match(/PER:\s*(.+?)(?=\s*TRN:|COMM:|SPESE:|$)/i);
    if (perMatch) {
      const causale = perMatch[1].trim().replace(/\s+/g, ' ');
      // Scarta se troppo corta, o se è solo punteggiatura/codici tecnici
      const isTechnical = /^[\d\s\W]+$/.test(causale) || /^TRN/i.test(causale);
      if (causale.length > 2 && !isTechnical) {
        return `Bonifico - ${this.toTitleCase(causale)}`;
      }
    }

    // 2. Nessuna causale valida → usa il nome del mittente/destinatario
    const nameRegex = direction === 'entrata'
      ? /DA:\s*([A-Za-z][A-Za-z\s]+?)(?=\s*PER:|TRN:|COMM:|$)/i
      : /\bA:\s*([A-Za-z][A-Za-z\s]+?)(?=\s*PER:|TRN:|COMM:|$)/i;
    const nameMatch = rawDesc.match(nameRegex);
    if (nameMatch) {
      const name = nameMatch[1].trim()
        .replace(/\bISTANTANEO\b|\bSEPA\b|\bDEL\b|\bALLE\b|\d{2}[.:]\d{2}[.:]\d{2,4}/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (name.length > 1) return `Bonifico - ${this.toTitleCase(name)}`;
    }

    return 'Bonifico';
  }

  /**
   * normalizeDate: supporta "DD.MM.YY" e "DD.MM.YYYY"
   */
  normalizeDate(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split('.');
    if (parts.length !== 3) return null;
    let [d, m, y] = parts;
    if (y.length === 2) y = '20' + y;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  toTitleCase(str) {
    if (!str) return '';
    return str.trim()
      .toLowerCase()
      .replace(/\b\w/g, c => c.toUpperCase())
      .replace(/\b(Di|Da|Del|Della|Dei|Degli|Delle|Il|La|Lo|Le|Gli|Un|Una|E|O|A|In|Con|Su|Per|Tra|Fra)\b/g, w => w.toLowerCase());
  }
}

module.exports = UniCreditParser;