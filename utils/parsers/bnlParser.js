// utils/parsers/bnlParser.js
// Parser specializzato per estratti conto BNL (BancaNazionaledelLavoro)
//
// STRUTTURA COORDINATA REALE (formato dal backend fileParser.js):
//
// RIGA DATA:
//   [50]DD/MM/YYYY [120]DD/MM/YYYY [197]COD [217]DESCRIZIONE... [X]IMPORTO €
//
// RIGA CONTINUZIONE (opzionale):
//   [217]esercente NOME COMMERCIANTE
//   oppure: [217]per CAUSALE BONIFICO
//   oppure: [217]di cui 0,00 per Commiss/Spese
//
// COLONNE IMPORTO:
//   X < 500  → USCITA  (tipicamente 464, 470, 474, 478)
//   X ≥ 500  → ENTRATA (tipicamente 524, 530, 533, 539)
//
// TIPI OPERAZIONE PRINCIPALI:
//   [197]43  Pag MAESTRO Carta XXXXXXXX ... → POS/Carta
//   [197]05  PRELIEVO BANCOMAT del ...      → Bancomat
//   [197]48  Bonifico del ... da ...        → Bonifico entrata
//   [197]26  Vostro bonifico - Spese: ...   → Bonifico uscita
//   [197]27  Emolumenti del ... da ...      → Stipendio/Emolumenti
//   [197]50  Addebito SEPA DD a fav. di ... → SEPA
//   [197]45  Utilizzo carta di credito      → Utilizzo CC
//   [197]66  Canone Conto BNL               → Canone/Spese
//   [197]41  Pagamento ricariche T.I.M.     → Ricariche
//   Pagamenti diversi CARICAMENTO CARTA ... → Ricarica prepagata

const BaseBankParser = require('./baseBankParser');

class BNLParser extends BaseBankParser {
  constructor() {
    super();
    this.bankName = 'BNL';
    
    this.identificationPatterns = [
      /BNL|BANCA NAZIONALE DEL LAVORO/i,
      /BNP PARIBAS/i,
      /IBAN\s+IT\s*\d{2}\s*[A-Z]\s*01005/i,
      /AQTMPL01/i,
    ];
  }

  canParse(content) {
    let score = 0;
    for (const pattern of this.identificationPatterns) {
      if (pattern.test(content)) score += 0.4;
    }
    if (content.includes('ESTRATTO CONTO')) score += 0.2;
    if (content.includes('QUALI SONO TUTTI I MOVIMENTI')) score += 0.3;
    if (content.includes('Pag MAESTRO Carta')) score += 0.3;
    return Math.min(score, 1.0);
  }

  parse(content) {
    this.log('Inizio parsing BNL PDF');
    const lines = content.split('\n');
    const transactions = [];
    let txCounter = 0;

    // Colonna X di separazione Uscite/Entrate
    const midpoint = 499;

    // Regex per riga principale di transazione BNL:
    // [50]DD/MM/YYYY [120]DD/MM/YYYY [197]COD [217]DESCRIZIONE [X]IMPORTO €
    const txLineRegex = /^\[50\](\d{2}\/\d{2}\/\d{4})\s+\[120\](\d{2}\/\d{2}\/\d{4})\s+\[197\](\d+)\s+\[217\](.+?)\s+\[(\d+)\]\s*([\d.]+,\d{2})\s*€?\s*$/;
    
    // Regex per riga continuazione: [217]testo
    const contLineRegex = /^\[217\](.+)$/;

    // Boilerplate da ignorare
    const isBoilerplate = (l) =>
      /AQTMPL01|Banca Nazionale del Lavoro|BNP Paribas|Viale Altiero Spinelli|Sede Legale|bnl\.it|Imposta di bollo|Fondo interbancario|Capitale Euro|Iscritta all'Albo|coordinamento del socio/i.test(l) ||
      /^\[48\]/.test(l) ||
      /^\[148\]/.test(l) ||
      /^\[23\]/.test(l) ||
      /QUALI SONO TUTTI I MOVIMENTI/i.test(l) ||
      /LA BANCA HA.*CON DECORRENZA|REGISTRATO SUL.*DEGLI INTERESSI|CONTO IN DATA.*DATA VALUTA/i.test(l) ||
      /^\[50\]\s*LA\s+BANCA\b/i.test(l) ||
      /^\[50\]\s*REGISTRATO\b/i.test(l) ||
      /^\[50\]\s*CONTO\s+IN\s+DATA/i.test(l) ||
      /^\[50\]\s*\(\s*DATA\s+CONTABILE/i.test(l) ||
      /SALDO\s+INIZIALE/i.test(l) ||
      /Rif\. interni:/i.test(l) ||
      /ESTRATTO CONTO N\./i.test(l) ||
      /A QUALE PERIODO|AI MOVIMENTI DAL/i.test(l) ||
      /L'ESTRATTO CONTO IN SINTESI|RIASSUNTO DELLE ENTRATE|CHE TIPO DI/i.test(l) ||
      /TOTALE ENTRATE|TOTALE USCITE|BILANCIO|LA DIFFERENZA TRA/i.test(l) ||
      /Stipendi e pensioni|Giroconto e bonifici|Prelievi bancomat|Utilizzo carte di credito/i.test(l) ||
      /Pagamento P\.O\.S\.|Utenze|Spese di bollo|Uscite, addebiti vari/i.test(l) ||
      /^\[363\]/.test(l) ||
      /^\[55\]/.test(l) ||
      /Rivolgiti al|Contatta il Servizio|Visita il sito|Numero \+39|Email:|Filiale di /i.test(l) ||
      /NORMATIVA ANTIRICICLAGGIO|ADEGUATA VERIFICA|SCADENZA QUESTIONARIO/i.test(l) ||
      /^\[47\]\s*$/.test(l) ||
      /I DATI CHE IDENTIFICANO/i.test(l) ||
      /Prodotto:|C\/C N\.|IBAN¹|BIC²/i.test(l);

    // Stop quando arriviamo al footer delle transazioni
    const isFooter = (l) =>
      /IL SALDO FINALE AL|QUAL E' IL SALDO FINALE/i.test(l) ||
      /RIASSUNTO SCALARE|DETTAGLIO DEGLI INTERESSI|INFORMAZIONI SUI TASSI/i.test(l);

    let inMovimentiSection = false;
    let currentTx = null;

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const line = rawLine.trim();
      if (!line) continue;

      // Attiva sezione movimenti
      if (/QUALI SONO TUTTI I MOVIMENTI/i.test(line)) {
        inMovimentiSection = true;
        continue;
      }

      // Stop su footer
      if (inMovimentiSection && isFooter(line)) {
        if (currentTx) {
          this.pushTransaction(transactions, currentTx, ++txCounter, midpoint);
          currentTx = null;
        }
        if (/SALDO\s+FINALE\s+AL/i.test(line)) inMovimentiSection = false;
        continue;
      }

      if (!inMovimentiSection) continue;
      if (isBoilerplate(line)) {
        // Se siamo su boilerplate ma abbiamo una tx in sospeso, la finiamo
        // (non pushiamo ancora — potrebbe esserci ancora una continuazione)
        continue;
      }

      // Prova a matchare riga transazione principale
      const txMatch = rawLine.match(txLineRegex);
      if (txMatch) {
        // Salva transazione precedente
        if (currentTx) {
          this.pushTransaction(transactions, currentTx, ++txCounter, midpoint);
        }

        const [, dateContabile, dateValuta, codAbi, descMain, xStr, amountStr] = txMatch;
        const x = parseInt(xStr);
        const amountVal = this.parseItalianAmount(amountStr);

        currentTx = {
          date: this.normalizeDate(dateContabile),
          descMain: descMain.trim(),
          descCont: '',     // riga continuazione (esercente, causale, ecc.)
          x,
          amount: amountVal,
          codAbi
        };
        continue;
      }

      // Prova a matchare riga continuazione [217]testo
      const contMatch = rawLine.match(contLineRegex);
      if (contMatch && currentTx) {
        const contText = contMatch[1].trim();
        // Ignora continuazioni boilerplate
        if (/SALDO\s+FINALE|RIASSUNTO|DETTAGLIO DEGLI INTERESSI/i.test(contText)) {
          this.pushTransaction(transactions, currentTx, ++txCounter, midpoint);
          currentTx = null;
          continue;
        }
        // Aggiungi continuazione solo se non è rumore
        if (contText && !/^\[47\]\s*$/.test(contText)) {
          currentTx.descCont = contText;
        }
        continue;
      }

      // Riga con data ma non nel formato standard (es. [50]31/03/2025 SALDO INIZIALE...)
      // Skip silenzioso
    }

    if (currentTx) this.pushTransaction(transactions, currentTx, ++txCounter, midpoint);

    this.log(`Parsed ${transactions.length} BNL transactions`);
    return this.postProcess(transactions);
  }

  /**
   * Costruisce e pulisce la descrizione di una transazione BNL, poi la aggiunge all'array.
   */
  pushTransaction(transactions, tx, id, midpoint) {
    if (!tx.date || isNaN(tx.amount) || tx.amount === 0) return;

    const isIncome = tx.x >= midpoint;
    const finalAmount = isIncome ? Math.abs(tx.amount) : -Math.abs(tx.amount);
    const description = this.buildDescription(tx);

    transactions.push({
      date: tx.date,
      description,
      amount: Math.round(finalAmount * 100) / 100,
      originalText: `${tx.descMain} | ${tx.descCont} [#${id}]`,
      confidence: 0.97,
      bank: 'BNL'
    });
  }

  /**
   * Costruisce una descrizione pulita in base al tipo di operazione.
   */
  buildDescription(tx) {
    const main = tx.descMain || '';
    const cont = tx.descCont || '';
    const upper = main.toUpperCase();

    // ─── POS / CARTA ─────────────────────────────────────────────────────────
    // Main: "Pag MAESTRO Carta 30950499 29.03.25 18:26 in EUR"
    // Cont: "esercente SUPERMERCATO GILAS SRL"
    if (/PAG\s+(?:MAESTRO|VISA|MASTERCARD|CARTA)/i.test(main) || /esercente/i.test(cont)) {
      const esercenteMatch = cont.match(/esercente\s+(.+)$/i);
      if (esercenteMatch) {
        const name = esercenteMatch[1].trim();
        return this.toTitleCase(name);
      }
      // Fallback: estrai ciò che segue "in EUR" o prendi dal main ripulito
      return this.toTitleCase(
        main.replace(/Pag\s+(?:MAESTRO|VISA|MASTERCARD)\s+/i, '')
            .replace(/Carta\s+\d+/i, '')
            .replace(/\d{2}\.\d{2}\.\d{2,4}\s+\d{2}:\d{2}/g, '')
            .replace(/in\s+EUR/gi, '')
            .replace(/\s+/g, ' ')
            .trim()
      ) || 'Pagamento Carta';
    }

    // ─── PRELIEVO BANCOMAT ────────────────────────────────────────────────────
    // Main: "PRELIEVO BANCOMAT del 11.04.25 ore 23:01 Carta 32616362"
    if (/PRELIEVO\s+BANCOMAT/i.test(main)) {
      return 'Prelievo Bancomat';
    }

    // ─── BONIFICO IN ENTRATA ─────────────────────────────────────────────────
    // Main: "Bonifico del 14.04.25 da ASSILT per MANDATO:9454185 DIS"
    // Cont: (nulla o causale extra)
    if (/Bonifico del\s+\d{2}\.\d{2}\.\d{2}/i.test(main) && !main.includes('Vostro')) {
      return this.extractBonificoEntrata(main, cont);
    }

    // ─── BONIFICO IN USCITA ───────────────────────────────────────────────────
    // Main: "Vostro bonifico - Spese: 1,00EUR MOB-69105090380 BC FAV. 02008-09500 CROLLA LORENZO"
    // Cont: "MOB-69105090380 BC FAV. 02008-09500 CROLLA LORENZO"
    if (/Vostro\s+bonifico/i.test(main)) {
      return this.extractBonificoUscita(main, cont);
    }

    // ─── STIPENDIO / EMOLUMENTI ───────────────────────────────────────────────
    // Main: "Emolumenti del 23.04.25 da MINISTERO DELLA DIFESA"
    // Cont: "per STIPENDIO RATA CONTINUATIVA MESE DI APRILE 2025"
    if (/Emolumenti\s+del/i.test(main)) {
      const fromMatch = main.match(/da\s+(.+)$/i);
      const causale = cont.replace(/^per\s+/i, '').trim();
      if (fromMatch) {
        const mittente = this.toTitleCase(fromMatch[1].replace(/Emolumenti|del|da/gi, '').trim());
        if (causale) return `${mittente} - ${this.toTitleCase(causale)}`;
        return mittente;
      }
      return this.toTitleCase(cont.replace(/^per\s+/i, '')) || 'Stipendio';
    }

    // ─── ADDEBITO SEPA / SDD ─────────────────────────────────────────────────
    // Main: "Addebito SEPA DD a fav. di TOYOTA FINANCIAL SERVICES"
    // Cont: "di cui 0,00 per Commiss/Spese"
    if (/Addebito\s+SEPA|SDD/i.test(main)) {
      const favMatch = main.match(/fav\.\s+di\s+(.+)$/i);
      if (favMatch) {
        return this.toTitleCase(favMatch[1].trim());
      }
      return 'Addebito SEPA';
    }

    // ─── UTILIZZO CARTA CREDITO ───────────────────────────────────────────────
    if (/Utilizzo\s+carta\s+di\s+credito/i.test(main)) {
      return 'Utilizzo Carta di Credito';
    }

    // ─── CANONE / SPESE BANCARIE ─────────────────────────────────────────────
    if (/Canone\s+Conto\s+BNL/i.test(main)) return 'Canone Conto BNL';
    if (/Imposta\s+bollo/i.test(main)) return 'Imposta di Bollo';
    if (/Commissioni\s+Quota\s+annuale\s+Carta/i.test(main)) {
      return 'Quota Annuale Carta';
    }
    if (/^Commissioni$/i.test(main.trim())) return 'Commissioni Bancarie';
    if (/Commissioni/i.test(main)) return 'Commissioni Bancarie';

    // ─── RICARICA TIM / TELEFONIA ─────────────────────────────────────────────
    if (/Pagamento\s+ricariche\s+T\.I\.M\./i.test(main)) return 'Ricarica TIM';

    // ─── RICARICA CARTA PREPAGATE ─────────────────────────────────────────────
    if (/CARICAMENTO\s+CARTA/i.test(main)) {
      const numMatch = main.match(/CARTA\s+NUMERO\s+(\d+)/i);
      return numMatch ? `Ricarica Carta ${numMatch[1]}` : 'Ricarica Carta Prepagata';
    }

    // ─── PAGAMENTI DIVERSI ────────────────────────────────────────────────────
    if (/Pagamenti\s+diversi/i.test(main)) {
      const detail = main.replace(/Pagamenti\s+diversi\s*/i, '').trim();
      if (/TELEPASS/i.test(detail)) return 'Telepass';
      return this.toTitleCase(detail.replace(/\d{5,}/g, '').trim()) || 'Pagamento';
    }

    // ─── STORNO ───────────────────────────────────────────────────────────────
    if (/Storno\s+scrittura/i.test(main)) {
      return this.toTitleCase(main.replace(/Storno\s+scrittura\s+per\s+/i, '').trim());
    }

    // ─── SPESE BONIFICO ISTANTANEO (SCTINST) ────────────────────────────────
    if (/SCTINST|Spese\s+Sctinst/i.test(main)) {
      return 'Spese Bonifico Istantaneo';
    }

    // ─── FALLBACK ─────────────────────────────────────────────────────────────
    const cleaned = main
      .replace(/\[\d+\]/g, '')
      .replace(/\d{2}\/\d{2}\/\d{4}/g, '')   
      .replace(/\d{2}\.\d{2}\.\d{2,4}/g, '')  
      .replace(/\d{2}:\d{2}/g, '')            
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length > 2) return this.toTitleCase(cleaned);
    if (cont.length > 2) return this.toTitleCase(cont.replace(/^(?:esercente|per)\s+/i, '').trim());
    return 'Operazione Bancaria';
  }

  /**
   * Estrae la descrizione di un bonifico in entrata.
   * Main: "Bonifico del 14.04.25 da ASSILT per MANDATO:9454185 DIS"
   */
  extractBonificoEntrata(main, cont) {
    // Cerca mittente (dopo "da")
    const daMatch = main.match(/da\s+([A-Za-z][\w\s.\-àèìòùÀÈÌÒÙ]+?)(?:\s+per\s+|\s+MAND|\s*$)/i);
    const perMatch = main.match(/per\s+(.+)$/i);
    
    const mittente = daMatch ? daMatch[1].trim() : '';
    let causale = perMatch ? perMatch[1].trim() : '';
    
    // Pulizia causale (rimuovi MANDATO:xxxx, CODICE, ecc.)
    causale = causale
      .replace(/MANDATO\s*:\s*\w+/gi, '')
      .replace(/\bDIS\b/gi, '')
      .replace(/\bCODICE\b.*/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Combina con eventuale continuazione
    if (cont) {
      causale = causale ? `${causale} ${cont}` : cont;
      causale = causale.replace(/^per\s+/i, '').trim();
    }

    if (mittente && causale) return `Bonifico - ${this.toTitleCase(causale)}`;
    if (mittente) return `Bonifico - ${this.toTitleCase(mittente)}`;
    if (causale) return `Bonifico - ${this.toTitleCase(causale)}`;
    return 'Bonifico';
  }

  /**
   * Estrae la descrizione di un bonifico in uscita.
   * Main: "Vostro bonifico - Spese: 1,00EUR MOB-69105090380 BC FAV. 02008-09500 CROLLA LORENZO"
   * Cont: "MOB-69105090380 BC FAV. 02008-09500 CROLLA LORENZO" (a volte)
   */
  extractBonificoUscita(main, cont) {
    // Pulisce il main dai tecnicismi BNL
    const cleaned = main
      .replace(/Vostro\s+bonifico\s*/i, '')
      .replace(/-\s*Spese\s*:\s*[\d,\.]+\s*EUR?/gi, '')  // "- Spese: 1,00EUR"
      .replace(/\b(?:MOB|WEB)-\d+/gi, '')                 // "MOB-69105090380"
      .replace(/\bBC\b/gi, '')                             // "BC"
      .replace(/\bFAV\.\s*/gi, '')                         // "FAV."
      .replace(/\b\d{5}-\d{5}\b/g, '')                    // IBAN parziali "02008-09500"
      .replace(/^\s*[-–]\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Usa continuazione se disponibile (spesso ha il nome del beneficiario più chiaro)
    let source = cont || cleaned;
    source = source
      .replace(/\b(?:MOB|WEB)-\d+/gi, '')
      .replace(/\bBC\s+FAV\.\s*/gi, '')
      .replace(/\b\d{5}-\d{5}\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (source.length > 2) return `Bonifico - ${this.toTitleCase(source)}`;
    if (cleaned.length > 2) return `Bonifico - ${this.toTitleCase(cleaned)}`;
    return 'Bonifico';
  }

  /**
   * Converte importo italiano "1.234,56" → 1234.56
   */
  parseItalianAmount(str) {
    if (!str) return NaN;
    return parseFloat(str.replace(/\./g, '').replace(',', '.'));
  }

  /**
   * Normalizza data da DD/MM/YYYY a YYYY-MM-DD
   */
  normalizeDate(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split('/');
    if (parts.length !== 3) return null;
    const [d, m, y] = parts;
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

module.exports = BNLParser;