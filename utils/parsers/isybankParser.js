// utils/parsers/isybankParser.js
// Parser specializzato per estratti conto isybank (ex-EasyBank, gruppo Intesa Sanpaolo)

const BaseBankParser = require('./baseBankParser');

const ACCREDITO_MIN_X = 510;

class IsybankParser extends BaseBankParser {
  constructor() {
    super();
    this.bankName = 'isybank';
    this.identificationPatterns = [
      /isybank/i,
      /ISYBITMM/i,
      /www\.isybank\.com/i,
      /IBAN\s+IT\d{2}\s+M033\s?8/i,
      /Piano\s+isy/i,
    ];
  }

  // ─── Identificazione ───────────────────────────────────────────────────────

  canParse(content) {
    let score = 0;
    for (const pattern of this.identificationPatterns) {
      if (pattern.test(content)) score += 0.35;
    }
    if (/DESCRIZIONE\s+ADDEBITI\s+ACCREDITI/i.test(content)) score += 0.2;
    if (/DATA CONTABILE.*DATA OPERAZIONE/i.test(content)) score += 0.2;
    return Math.min(score, 1.0);
  }

  // ─── Entry point ───────────────────────────────────────────────────────────

  parse(content) {
    this.log('Inizio parsing isybank PDF');
    const hasCoordinates = /\[\d+\]/.test(content);
    let transactions;
    if (hasCoordinates) {
      this.log('Modalità: testo con coordinate [X]');
      transactions = this.parseCoordinated(content);
    } else {
      this.log('Modalità: testo grezzo (fallback pdf-parse standard)');
      transactions = this.parseRaw(content);
    }
    this.log(`Parsed ${transactions.length} isybank transactions`);
    return this.postProcess(transactions);
  }

  // ─── MODALITÀ 1: Testo con coordinate [X] ─────────────────────────────────

  parseCoordinated(content) {
    const lines = content.split('\n');
    const transactions = [];

    // Riga principale:  [36]DD.MM.YYYY [107]DD.MM.YYYY [177]Descrizione [X_amt]XX,XX [X]€
    const txMainRegex = /^\[36\](\d{2}\.\d{2}\.\d{4})\s+\[107\](\d{2}\.\d{2}\.\d{4})\s+\[177\](.+?)\s+\[(\d+)\]([\d.,]+)\s*(?:\[\d+\])?\s*€?\s*$/;
    const detailRegex = /^\[177\](.+)$/;
    const amountOnlyRegex = /^\[(\d+)\]([\d.,]+)\s*(?:\[\d+\])?\s*€\s*$/;

    let currentTx = null;
    let inMovimenti = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Attiva sezione movimenti
      if (/\[177\]DESCRIZIONE|DATA CONTABILE.*DATA OPERAZIONE/i.test(line)) {
        inMovimenti = true;
        continue;
      }

      // Stop su saldo finale
      if (inMovimenti && /Saldo\s+(finale|del\s+periodo)\s+al/i.test(line) && /\[36\]/.test(line)) {
        if (currentTx) { this.pushCoordinatedTx(transactions, currentTx); currentTx = null; }
        break;
      }

      // ── Page separator [14]5124372979... ────────────────────────────────
      // Può contenere una nuova transazione [36] o un dettaglio [177] inline
      if (/^\[14\]5124372979/.test(line)) {
        const afterPageCode = lines[i].replace(/^\[14\]5124372979\S+\s*/, '').trim();
        if (afterPageCode) {
          // Caso A: nuova transazione principale [36]
          const inlineTxMatch = afterPageCode.match(txMainRegex);
          if (inlineTxMatch) {
            if (currentTx) this.pushCoordinatedTx(transactions, currentTx);
            const [, dateC, dateO, operationType, xStr, amountStr] = inlineTxMatch;
            currentTx = {
              dateContabile: this.normalizeDotDate(dateC),
              dateOperazione: this.normalizeDotDate(dateO),
              operationType: operationType.trim(),
              details: [],
              amount: this.parseEuAmount(amountStr),
              isIncomeByPosition: parseInt(xStr) >= ACCREDITO_MIN_X
            };
            inMovimenti = true;
            continue;
          }
          // Caso B: dettaglio [177]
          const inlineDetailMatch = afterPageCode.match(detailRegex);
          if (inlineDetailMatch && currentTx) {
            const d = inlineDetailMatch[1].trim();
            if (d && !this.isDetailBoilerplate(d)) currentTx.details.push(d);
          }
        }
        continue;
      }

      // Ignora altri boilerplate (header, footer, telcos, ecc.)
      if (this.isCoordBoilerplate(line)) continue;

      // Riga principale transazione
      const txMatch = lines[i].match(txMainRegex);
      if (txMatch) {
        if (currentTx) this.pushCoordinatedTx(transactions, currentTx);
        const [, dateC, dateO, operationType, xStr, amountStr] = txMatch;
        currentTx = {
          dateContabile: this.normalizeDotDate(dateC),
          dateOperazione: this.normalizeDotDate(dateO),
          operationType: operationType.trim(),
          details: [],
          amount: this.parseEuAmount(amountStr),
          isIncomeByPosition: parseInt(xStr) >= ACCREDITO_MIN_X
        };
        inMovimenti = true;
        continue;
      }

      if (!inMovimenti || !currentTx) continue;

      // Riga dettaglio [177]
      const detailMatch = lines[i].match(detailRegex);
      if (detailMatch) {
        const detail = detailMatch[1].trim();
        if (detail && !this.isDetailBoilerplate(detail)) currentTx.details.push(detail);
        continue;
      }

      // Importo standalone su riga separata (edge case)
      const amountMatch = lines[i].match(amountOnlyRegex);
      if (amountMatch && currentTx.amount === null) {
        currentTx.amount = this.parseEuAmount(amountMatch[2]);
        currentTx.isIncomeByPosition = parseInt(amountMatch[1]) >= ACCREDITO_MIN_X;
      }
    }

    if (currentTx) this.pushCoordinatedTx(transactions, currentTx);
    return transactions;
  }

  pushCoordinatedTx(transactions, tx) {
    if (!tx.dateContabile || tx.amount === null || isNaN(tx.amount) || tx.amount === 0) return;
    const isIncome = tx.isIncomeByPosition;
    const finalAmount = isIncome ? Math.abs(tx.amount) : -Math.abs(tx.amount);
    const description = this.buildDescription(tx.operationType, tx.details);
    transactions.push({
      date: tx.dateContabile,
      description,
      amount: Math.round(finalAmount * 100) / 100,
      originalText: ([tx.operationType, ...tx.details].join(' | ')).substring(0, 500),
      confidence: 0.97,
      bank: 'isybank'
    });
  }

  // ─── MODALITÀ 2: Testo grezzo ──────────────────────────────────────────────

  parseRaw(content) {
    const lines = content.split('\n');
    const transactions = [];
    const txStartRegex = /^(\d{2}\.\d{2}\.\d{4})(\d{2}\.\d{2}\.\d{4})(.+)$/;
    const amountRegex = /^[-+]?\d{1,3}(?:\.\d{3})*,\d{2}\s*€\s*$/;
    let currentBlock = null;
    let inMovimenti = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (/DATA CONTABILE.*DATA OPERAZIONE/i.test(line) ||
          /DESCRIZIONE\s+ADDEBITI\s+ACCREDITI/i.test(line) ||
          /^\d{2}\.\d{2}\.\d{4}\d{2}\.\d{2}\.\d{4}/.test(line)) {
        inMovimenti = true;
        if (!/^\d{2}\.\d{2}\.\d{4}\d{2}\.\d{2}\.\d{4}/.test(line)) continue;
      }

      if (this.isPageBreak(line)) continue;
      if (this.isFooter(line)) {
        if (currentBlock) { this.pushRawBlock(transactions, currentBlock); currentBlock = null; }
        if (/Saldo\s+(finale|del\s+periodo)\s+al/i.test(line)) break;
        continue;
      }
      if (this.isHeaderRepeat(line)) continue;

      const txMatch = line.match(txStartRegex);
      if (txMatch) {
        if (currentBlock) this.pushRawBlock(transactions, currentBlock);
        currentBlock = { dateContabile: this.normalizeDotDate(txMatch[1]), operationType: txMatch[3].trim(), details: [], amount: null };
        inMovimenti = true;
        continue;
      }

      if (!currentBlock) continue;

      if (amountRegex.test(line)) {
        if (currentBlock.amount === null) currentBlock.amount = this.parseEuAmount(line);
        continue;
      }

      if (!this.isRawBoilerplate(line)) currentBlock.details.push(line);
    }

    if (currentBlock) this.pushRawBlock(transactions, currentBlock);
    return transactions;
  }

  pushRawBlock(transactions, block) {
    if (!block.dateContabile || block.amount === null || isNaN(block.amount) || block.amount === 0) return;
    const isIncome = this.determineSignFromType(block.operationType, block.details);
    const finalAmount = isIncome ? Math.abs(block.amount) : -Math.abs(block.amount);
    const description = this.buildDescription(block.operationType, block.details);
    transactions.push({
      date: block.dateContabile,
      description,
      amount: Math.round(finalAmount * 100) / 100,
      originalText: ([block.operationType, ...block.details].join(' | ')).substring(0, 500),
      confidence: 0.95,
      bank: 'isybank'
    });
  }

  determineSignFromType(operationType, details) {
    const text = (operationType + ' ' + details.join(' ')).toLowerCase();
    if (/storno\s+pagamento|storno\b/.test(text)) return true;
    if (/bonifico a vostro favore/.test(text)) return true;
    if (/versamento contanti/.test(text)) return true;
    if (/^accredito/.test(text)) return true;
    if (/riaccredito/.test(text)) return true;
    return false;
  }

  // ─── Costruisce descrizione leggibile ─────────────────────────────────────

  buildDescription(operationType, details) {
    const op = operationType || '';

    if (/Storno\s+Pagamento/i.test(op))                    return 'Storno Pagamento';
    if (/Pagamento\s+(POS|Tramite\s+POS|su\s+POS)/i.test(op)) return this.extractPosDescription(details, op);
    if (/Storno\b/i.test(op))                              return 'Storno';
    if (/Prelievo\s+Bancomat/i.test(op))                   return 'Prelievo Bancomat';
    if (/Versamento\s+contanti/i.test(op))                 return 'Versamento Contanti ATM';
    if (/Bonifico\s+a\s+Vostro\s+favore/i.test(op))        return this.extractBonificoEntrata(details);
    if (/Bonifico\s+da\s+Voi\s+disposto/i.test(op))        return this.extractBonificoUscita(details);
    if (/^Addebito\b/i.test(op)) { const c = op.replace(/^Addebito\s+/i,'').trim(); return c.length>2 ? this.toTitleCase(c) : 'Addebito'; }
    if (/^Accredito\b/i.test(op)) { const c = op.replace(/^Accredito\s+/i,'').trim(); return c.length>2 ? this.toTitleCase(c) : 'Accredito'; }
    if (/Commissioni?/i.test(op))                          return 'Commissioni Bancarie';
    if (/Canone/i.test(op))                                return 'Canone Conto';
    if (/Imposta\s+di\s+bollo/i.test(op))                  return 'Imposta di Bollo';
    if (/Trasferimento\s+Denaro/i.test(op))                return 'Trasferimento Denaro';
    if (/Pagamento\s+Adue/i.test(op))                      return 'Pagamento F24/Agenzia';

    const cleanOp = op.replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
    if (cleanOp.length > 3) return this.toTitleCase(cleanOp);
    const firstDetail = details.find(d => d.length > 3 && !this.isDetailBoilerplate(d));
    if (firstDetail) return this.toTitleCase(firstDetail);
    return 'Operazione Bancaria';
  }

  // ─── Estrai merchant da Pagamento POS ─────────────────────────────────────
  //
  // Formato 1 "PRESSO":     PRESSO NOME MERCHANT    CITTA
  // Formato 2 "TRAMITE POS": NOME INDIRIZZO_TRONCATODD/MM-HH:MM - Carta n....
  //                           (indirizzo si fonde direttamente con la data, senza spazio)
  // Formato 3 "SU POS":     Pagamento su POS NOME MERCHANT

  extractPosDescription(details, operationType) {
    const cleanDetails = details.filter(d =>
      d.length < 200 &&
      !/^EFFETTUATO IL/i.test(d) &&
      !/^MEDIANTE LA CARTA/i.test(d) &&
      !/^- Carta n\./i.test(d) &&
      !/^COD\.\d+/i.test(d) &&
      !/^ABI\s*:/i.test(d) &&
      !/^\d{5,}$/.test(d.trim()) &&
      !/^Terminal\s+ID/i.test(d) &&
      !/mancanza|approvati|imposta.*bollo|agenzia.*entrate|autorizzazione/i.test(d)
    );

    for (const d of cleanDetails) {
      // ── Formato 1: "PRESSO NOME    CITTA" ────────────────────────────────
      if (/^PRESSO\s+/i.test(d)) {
        let rest = d.replace(/^PRESSO\s+/i, '').trim();
        rest = rest.split(/\s{3,}/)[0].trim();
        rest = rest.replace(/\s+\d{8,}$/, '').trim();
        if (rest.length > 2 && rest.length < 80 && !/^\d+$/.test(rest)) {
          return this.toTitleCase(this.cleanMerchantName(rest));
        }
      }

      // ── Formato 2a: "NOME [INDIRIZZO]DD/MM-HH:MM" con spazio prima della data
      const timedWithSpace = d.match(/^(.+?)\s+\d{2}\/\d{2}[-]\d{2}:\d{2}/);
      // ── Formato 2b: "NOME INDIRIZZODD/MM-HH:MM" senza spazio (troncatura) ─
      const timedNoSpace = d.match(/^(.+?[A-Za-z])\d{2}\/\d{2}[-]\d{2}:\d{2}/);
      const timedMatch = timedWithSpace || timedNoSpace;
      if (timedMatch) {
        const name = this.cleanMerchantName(timedMatch[1]);
        if (name.length > 2 && name.length < 80) {
          return this.toTitleCase(name);
        }
      }
    }

    // ── Formato 3: nome nel tipo operazione "Pagamento su POS NOME" ─────────
    const posNameMatch = operationType.match(/Pagamento\s+su\s+POS\s+(.+)/i);
    if (posNameMatch) {
      const name = this.cleanMerchantName(posNameMatch[1]);
      if (name.length > 2 && name.length < 80) return this.toTitleCase(name);
    }

    // ── Ultimo fallback: primo dettaglio pulito disponibile ──────────────────
    for (const d of cleanDetails) {
      const cleaned = this.cleanMerchantName(d);
      if (cleaned.length > 3 && cleaned.length < 60 &&
          !/^(?:ABI|COD\.|MEDIANTE|EFFETTUATO|Terminal|Carta)/i.test(d) &&
          !/^\d+$/.test(d.trim())) {
        return this.toTitleCase(cleaned);
      }
    }

    return 'Pagamento POS';
  }

  // ─── Pulisce il nome del merchant da rumori tipici dei PDF isybank ─────────
  //
  // Rimuove sulla base di pattern GENERALI (non specifici a questi estratti conto):
  //   • Date/ora embedded: DD/MM-HH[:MM]  o  DD/MM-HH:MM - ...
  //   • Indirizzi stradali troncati: VIA, VIALE, CORSO, PIAZZA, PIAZZ, LARGO, ecc.
  //   • Suffissi carte: ABI, COD., Carta n.
  //   • Trattini e spazzatura finale

  cleanMerchantName(str) {
    if (!str) return '';
    let s = str;

    // 1. Rimuovi data/ora e tutto ciò che segue (DD/MM-HH:MM, DD/MM-HH, DD/MM-)
    s = s.replace(/\s*\d{2}\/\d{2}[-]\d{2}(:\d{2})?.*$/, '');
    // Formato senza spazio prima: "NOMEDD/MM-HH:MM" → già gestito dalla regex timedNoSpace,
    // ma per il cleanMerchantName togliere in ogni caso il suffisso data
    s = s.replace(/\d{2}\/\d{2}[-]\d{2}(:\d{2})?.*$/, '');

    // 2. Rimuovi indirizzi stradali in coda (con eventuale parola parziale):
    //    "VIALE IP" → "" ,  "VIA IPPOCRA" → ""  ,  "PIAZZ" → ""
    //    Matcha: (strada) + eventuale parola successiva troncata
    s = s.replace(/\s+(VIA|VIALE|CORSO|PIAZZA?|PIAZZ|LARGO|VICOLO|P\.?ZZA?|TRAVERSE?)\s*\S*\s*$/i, '');
    // Secondo passaggio: se rimane solo la parola stradale senza nulla dopo
    s = s.replace(/\s+(VIA|VIALE|CORSO|PIAZZA?|PIAZZ|LARGO|VICOLO)$/i, '');

    // 3. Rimuovi suffissi tecnici coda: ABI :, COD., Carta n.
    s = s.replace(/\s+(ABI|COD\.?)\s*:?\s*\d+.*$/i, '');
    s = s.replace(/\s+Carta\s+n\.?.*$/i, '');

    // 4. Rimuovi trattini finali e spazzatura (" - ", " -", "- ")
    s = s.replace(/\s*[-–]+\s*$/, '');

    // 5. Rimuovi codici alfanumerici puri in coda (es. "XX02", "IP", "9515")
    s = s.replace(/\s+[A-Z]{0,2}\d{2,}$/, '');

    // 6. Normalizza spazi
    s = s.replace(/\s+/g, ' ').trim();

    return s;
  }

  // ─── Estrai descrizione Bonifico Entrata ──────────────────────────────────

  extractBonificoEntrata(details) {
    const text = details.join(' ');
    const mittMatch = text.match(/MITT\.?:?\s*([A-Z][\w\s.àèìòùÀÈÌÒÙ&',-]+?)(?:\s+COD\.?\s*DISP\.?|\s+BIC\.?\s+ORD\.?|\s+BENEF\.?|$)/i);
    if (mittMatch) {
      let mittente = mittMatch[1].trim().replace(/\d{10,}/g, '').replace(/\s+/g, ' ').trim();
      if (mittente.length > 2 && !/^\d+$/.test(mittente)) {
        const causaleLines = details.filter(d =>
          d.length > 3 && d.length < 100 &&
          !/^(?:MITT\.|COD\.|BENEF\.|BIC\.|PAYPAL|INSTANT|TRANSFER|\d+$)/i.test(d.trim())
        );
        if (causaleLines.length > 0) {
          return `Bonifico da ${this.toTitleCase(mittente)} - ${this.toTitleCase(causaleLines[0])}`;
        }
        return `Bonifico da ${this.toTitleCase(mittente)}`;
      }
    }
    return 'Bonifico';
  }

  // ─── Estrai descrizione Bonifico Uscita ───────────────────────────────────

  extractBonificoUscita(details) {
    const text = details.join(' ');
    const aFavoreMatch = text.match(/a\s+favore\s+di\s*:?\s*([A-Za-z][\w\s.àèìòùÀÈÌÒÙ&',-]+?)(?:\n|\s{3,}|\d{10,}|$)/i);
    if (aFavoreMatch) {
      const bene = aFavoreMatch[1].trim().replace(/\s+/g, ' ');
      if (bene.length > 2 && bene.length < 80) return `Bonifico a ${this.toTitleCase(bene)}`;
    }
    return 'Bonifico';
  }

  // ─── Helper ───────────────────────────────────────────────────────────────

  parseEuAmount(str) {
    if (!str) return NaN;
    return parseFloat(str.replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.'));
  }

  normalizeDotDate(dateStr) {
    if (!dateStr) return null;
    const m = dateStr.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!m) return null;
    return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }

  isCoordBoilerplate(line) {
    return /^\[14\]5124372979/.test(line) ||
           /\[489\]Pagina\s+\[513\]\d+\s+di\s+\d+/.test(line) ||
           /\[180\].*isybank\.com/i.test(line) ||
           /\[40\]Serve\s+aiuto/i.test(line) ||
           /\[369\]Dal\s+lunedì/i.test(line) ||
           /Dall'Italia:\s*800/i.test(line) ||
           /Terminal\s+ID:/i.test(line) ||
           /\[36\]DATA CONTABILE/.test(line);
  }

  isDetailBoilerplate(detail) {
    return /^\d{7,}$/.test(detail.trim()) ||
           /^5124372979/.test(detail) ||
           /isybank\.com/i.test(detail) ||
           /Terminal\s+ID/i.test(detail);
  }

  isPageBreak(line) {
    return /^\d{10,}-\d{5,}/.test(line) ||
           /^Pagina\s+\d+\s+di\s+\d+$/i.test(line) ||
           /Terminal\s+ID:/i.test(line);
  }

  isHeaderRepeat(line) {
    return /^DATA CONTABILE.*DATA OPERAZIONE/i.test(line) ||
           /^DESCRIZIONE\s+ADDEBITI\s+ACCREDITI/i.test(line);
  }

  isFooter(line) {
    return /Saldo\s+(finale|del\s+periodo)\s+al/i.test(line) ||
           /INFORMAZIONI SUI TASSI/i.test(line) ||
           /RIEPILOGO\s+DELLE\s+COMMISSIONI/i.test(line) ||
           /Allegati\s+presenti/i.test(line);
  }

  isRawBoilerplate(line) {
    return /Serv[ei]\s+aiuto/i.test(line) ||
           /Dall['']Italia|Dall['']estero/i.test(line) ||
           /isybank\.com|www\.isybank/i.test(line) ||
           /Coordinate bancarie/i.test(line) ||
           /IBAN\s+IT/i.test(line) ||
           /BIC\s+ISYBITMM/i.test(line) ||
           /Tipologia\s+di\s+conto/i.test(line) ||
           /Milano,\s+\d/i.test(line) ||
           /Riepilogo\s+conto/i.test(line) ||
           /Saldo\s+iniziale\s+al/i.test(line) ||
           /Totale\s+accrediti/i.test(line) ||
           /Totale\s+addebiti/i.test(line) ||
           /Saldo\s+del\s+periodo/i.test(line) ||
           /^\d{7,}$/.test(line.trim()) ||
           /^5124372979/.test(line);
  }
}

module.exports = IsybankParser;
