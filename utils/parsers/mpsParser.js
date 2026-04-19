const BaseBankParser = require('./baseBankParser');

/**
 * Parser per Banca Monte dei Paschi di Siena (MPS)
 * Utilizza l'euristica degli spazi finali (Trailing Space) per distinguere Entrate da Uscite.
 * In questo PDF:
 * - Le USCITE hanno uno spazio finale dopo l'importo.
 * - Le ENTRATE finiscono esattamente con l'ultima cifra dell'importo.
 */
class MpsParser extends BaseBankParser {
  constructor() {
    super();
    this.bankName = 'Monte dei Paschi di Siena';
  }

  canParse(content) {
    const uc = content.toUpperCase();
    if (uc.includes('MONTE DEI PASCHI') || uc.includes('MPS MIO') || uc.includes('BANCA MONTE DEI PASCHI')) {
      return 1.0;
    }
    return 0;
  }

  parse(content) {
    const lines = content.split('\n');
    const transactions = [];
    
    // State Machine
    let currentTx = null;
    let insideDettaglio = false;
    
    // RegEx per data accorpata tipo "01/10 01/10/2025" (Data Operazione + Data Valuta)
    // In produzione (Structured extraction) queste date sono spesso separate da spazi/marker
    const dateRegex = /^\s*(\d{2}\/\d{2})\s*(\d{2}\/\d{2}\/\d{4})/; 
    const amountRegex = /(\d{1,3}(?:\.\d{3})*,\d{2})/;
    // Riga di puro importo: molto spazio all'inizio, l'importo, e possibilmente uno spazio alla fine
    const pureAmountRegex = /^\s{8,}(\d{1,3}(?:\.\d{3})*,\d{2})\s?$/;

    for (let i = 0; i < lines.length; i++) {
        let rawLine = lines[i];
        
        // 🆕 Rimuoviamo i marker delle coordinate [123] per compatibilità con il fallback strutturato
        // Ma preserviamo gli spazi che circondano l'importo per l'euristica della colonna
        const cleanLine = rawLine.replace(/\[\d+\]/g, ''); 
        const trimmed = cleanLine.trim();
        const ucTrimmed = trimmed.toUpperCase();
        
        if (!trimmed) continue;

        // Filtro Sezioni - Iniziamo a guardare solo dopo il Dettaglio
        // Usiamo check più flessibili per coordinate split e variazioni di testo
        if (ucTrimmed.includes('DETTAGLIO OPERAZIONI')) { insideDettaglio = true; continue; }
        
        // Fine sezione: Riassunto scalare, competenze o salto a tabelle finali
        if (ucTrimmed.includes('SCALARE') || ucTrimmed.includes('COMPETENZE') || ucTrimmed.includes('SALDO LIQUIDO')) { 
            insideDettaglio = false; 
            continue; 
        }
        
        if (!insideDettaglio) continue;

        // Saltiamo intestazioni di tabella e boilerplate di pagina
        if (ucTrimmed.includes('DATAVALUTADESCRIZIONE OPERAZIONEUSCITEENTRATE')) continue;
        if (/Pag\.\s+\d+|BANCAMONTEDEIPASCH|Sede\s+sociale|Capitale\s+Sociale|Totale\s+entrate|Totale\s+uscite|Saldo\s+finale/i.test(trimmed)) continue;




        const dateMatch = cleanLine.match(dateRegex);
        const pureMatch = cleanLine.match(pureAmountRegex);
        const amMatch = cleanLine.match(amountRegex);
        
        // Verifica se la riga finisce con uno spazio (Euristica MPS: Uscita = termina con spazio)
        // Usiamo rawLine perché il marker di coordinata finale [X] potrebbe essere stato rimosso ma item.str preserva lo spazio
        const hasTrailingSpace = cleanLine.endsWith(' ');

        if (dateMatch) {
            // Se avevamo una transazione in sospeso, salviamola
            if (currentTx) {
                this.pushParsedTransaction(transactions, currentTx);
            }

            const valutaDate = dateMatch[2];
            const descStart = cleanLine.substring(cleanLine.indexOf(dateMatch[0]) + dateMatch[0].length).trim();
            
            currentTx = {
                dateStr: valutaDate,
                description: descStart,
                amount: null,
                isIncome: false,
                hasPureAmount: false
            };

            // Se l'importo è sulla stessa riga (molto raro per MPS ma gestito)
            if (amMatch && !pureMatch) {
                const amountStr = amMatch[1];
                const val = this.parseAmount(amountStr);
                if (val !== 0) {
                    currentTx.amount = val;
                    currentTx.isIncome = !hasTrailingSpace;
                    currentTx.description = currentTx.description.replace(amountStr, '').trim();
                }
            }
        } 
        else if (currentTx) {
            if (pureMatch) {
                // RIGA DI PURO IMPORTO: Questa è la riga definitiva per MPS
                const amountStr = pureMatch[1];
                currentTx.amount = this.parseAmount(amountStr);
                currentTx.isIncome = !hasTrailingSpace;
                currentTx.hasPureAmount = true; 
            } 
            else {
                // Accumuliamo descrizione
                if (currentTx.description) currentTx.description += ' ' + trimmed;
                else currentTx.description = trimmed;
                
                // Se troviamo un importo INLINE e non ne abbiamo ancora uno puro
                if (amMatch && !currentTx.hasPureAmount) {
                    const amountStr = amMatch[1];
                    const val = this.parseAmount(amountStr);
                    // Ignoriamo "COMM. SCT 0,00" o simili che sporcano il testo
                    if (val !== 0) {
                        currentTx.amount = val;
                        currentTx.isIncome = !hasTrailingSpace;
                    }
                }
            }
        }
    }


    // Ultima transazione
    if (currentTx) {
        this.pushParsedTransaction(transactions, currentTx);
    }

    return this.postProcess(transactions);
  }

  /**
   * Finalizza la transazione applicando ulteriore logica semantica di rinforzo e pulizia premium
   */
  pushParsedTransaction(list, tx) {
    if (tx.amount === null || tx.amount === undefined || tx.amount === 0) return;
    
    const rawText = tx.description;
    let cleanDesc = rawText;
    const descUp = rawText.toUpperCase();

    // 1. DETERMINAZIONE DIREZIONE (RINFORZO SEMANTICO)
    const normalizedUp = descUp.replace(/\s+/g, '');
    
    if (normalizedUp.includes('VOSTROFAVORE')) {
        tx.isIncome = true;
    } 
    else if (normalizedUp.includes('DISPOSTOTRAMITE') || normalizedUp.includes('AFAVORE')) {
        tx.isIncome = false;
    }
    else {
        const incomeKeywords = ['STIPENDIO', 'EMOLUMENTI', 'ACCREDITO', 'VERSAMENTOPROPRI', 'VERSAMENTOCONTANTE', 'SALDOPOSITIVO'];
        const expenseKeywords = ['ADDEBITO', 'PAGAMENTO', 'COMMISSIONE', 'IVA', 'CANONE', 'BONIFICOSEPAA', 'ACQUISTO', 'DISPOSIZIONE'];
        
        if (incomeKeywords.some(k => normalizedUp.includes(k))) {
            tx.isIncome = true;
        } else if (expenseKeywords.some(k => normalizedUp.includes(k))) {
            tx.isIncome = false;
        }
    }

    // 2. PULIZIA PREMIUM DELLA DESCRIZIONE
    // Helper per Title Case (Nomi Proprii più leggibili)
    const toTitleCase = (str) => {
        if (!str) return '';
        // Fix per parole comuni spezzate o maiuscole particolari
        str = str.replace(/DICE\s+MBRE/gi, 'DICEMBRE')
                 .replace(/GENN\s+AIO/gi, 'GENNAIO');

        // Manteniamo maiuscole sigle corte (es. ATM) e parole composte
        return str.toLowerCase().split(/\s+/).map(word => {
            if (word.length <= 3 && /^[a-z]+$/.test(word)) return word.toUpperCase();
            if (word.includes('&') || word.includes('+')) return word.toUpperCase();
            return word.charAt(0).toUpperCase() + word.slice(1);
        }).join(' ');
    };

    // 2.a CASI STRUTTURATI SPECIALI
    
    // CASO 1: STIPENDIO / EMOLUMENTI
    if (normalizedUp.includes('STIPENDIO') || normalizedUp.includes('EMOLUMENTI')) {
        const ordMatch = rawText.match(/ORD\s*[:\-]?\s*(.*?)(?=\bBIC\b|[:\-]\bIND\b|\bVIA\b|\bTRAV\b|\bCORS\b|:|\sINF\b|\bEE\b|\bCAUS\b|$)/i);
        const employer = ordMatch ? toTitleCase(ordMatch[1].trim()) : '';
        const monthRaw = rawText.replace(/OTTO\s*BRE/gi, 'OTTOBRE')
                                .replace(/NOVE\s*MBRE/gi, 'NOVEMBRE')
                                .replace(/DICE\s*MBRE/gi, 'DICEMBRE')
                                .replace(/GENN\s*AIO/gi, 'GENNAIO')
                                .replace(/FEBBR\s*AIO/gi, 'FEBBRAIO')
                                .replace(/SETT\s*EMBRE/gi, 'SETTEMBRE');
        const monthMatch = monthRaw.match(/MESE DI\s*(.*?)(?=CAUS|RI|$)/i);
        const month = monthMatch ? toTitleCase(monthMatch[1].trim()) : '';
        cleanDesc = `Stipendio ${employer}${month ? ' - ' + month : ''}`;
    }

    // CASO 2: ADDEBITI DIRETTI (SDD) - Priorità su bonifici perché contengono spesso "A FAVORE"
    else if (normalizedUp.includes('ADDEBITODIRETTO') || normalizedUp.includes('CODICEMANDATO')) {
        const targetMatch = rawText.match(/(?:\bA\b\s+FAVORE|\bESERCENTE\b|^A\b)\s*(.*?)(?=\bCODICE\b|\bMANDATO\b|\bIMPORTO\b|\bCOMMISSIONI\b|$)/i);
        let recipient = targetMatch ? targetMatch[1].trim() : '';
        recipient = recipient.replace(/\b(?:CODICE|MANDATO|IMPORTO|GMBH|S\.R\.L|S\.P\.A|S\.N\.C)\b/gi, '').replace(/\bN\.\s*\d+\b/gi, '').trim();
        
        const installmentMatch = rawText.match(/INSTALLMENT\s*N?\.?\s*(\d+)/i) || rawText.match(/RATA\s*N?\.?\s*(\d+)/i);
        const installment = installmentMatch ? `Rata ${installmentMatch[1]}` : '';
        const typeMatch = rawText.match(/LOAN|PRESTITO|FINANZIAMENTO/i);
        const type = typeMatch ? 'Finanziamento' : '';
        
        if (recipient && recipient.length > 2) {
            cleanDesc = toTitleCase(recipient);
            if (type || installment) cleanDesc += ` - ${type}${type && installment ? ' ' : ''}${installment}`;
        } else {
            cleanDesc = [type, installment].filter(Boolean).join(' ') || 'Addebito Diretto';
        }
    }
    // CASO 3: POS (Mastercard/Visa)
    else if (normalizedUp.includes('ESERCENTE')) {
        const esercenteMatch = rawText.match(/ESERCENTE\s*[:\-]?\s*(.*?)(?=IMP\.|IMP\s+IN|DATA\s+\d|ORA\s+\d|COM\.|N\.CARTA|$)/i);
        if (esercenteMatch && esercenteMatch[1].trim().length > 2) {
            let name = esercenteMatch[1].trim();
            // Codice POS puro: PV6168, PV8195, F03010 GDF, numeri soli
            const isPosCode = /^[A-Z]{1,3}\d{4,}$/i.test(name) ||  // PV6168
                              /^\d{4,}/.test(name) ||                // puri numeri
                              (name.length < 5 && /^[A-Z0-9 ]+$/.test(name)); // breve codice
            if (isPosCode) cleanDesc = 'Pagamento POS';
            else cleanDesc = toTitleCase(name);
        } else {
            cleanDesc = 'Pagamento POS';
        }
    }
    // CASO 4: BONIFICI IN ENTRATA (A VOSTRO FAVORE, DALL'ESTERO, ACCREDITO)
    else if (normalizedUp.includes('VOSTROFAVORE') || normalizedUp.includes('BONIFICODALL') || normalizedUp.includes('ACCREDITOEMOLUMENTI')) {
        // Estrazione donor (mittente)
        const ordMatch = rawText.match(/(?:ORD|MITT|DA)\s*[:\-]?\s*(.*?)(?=\bBIC\b|[:\-]\bIND\b|\bVIA\b|\bTRAV\b|\bCORS\b|\bINF\b|\bEE\b|\bCAUS\b|\bRI\b|:|\sINF\b|$)/i);
        let donor = ordMatch ? ordMatch[1].trim() : '';
        
        // Pulizia donor (mittente) soft
        donor = donor
            .replace(/(?:\bBON\b|\bIST\b|\bDEL\b|\bORD\b|INE\/|BIC|IND|VIA|TRAV|CORS|INF|EE|CAUS|RI|BEN\.FIN)/gi, ' ')
            .replace(/[:\-]/g, ' ')
            .replace(/\b\d{2}\.\d{2}\.\d{2}\b/g, '') 
            .replace(/\s+/g, ' ')
            .trim();
        
        let reason = '';
        // Cerchiamo la causale (RI o CAUS) in modo estensivo
        const causMatch = rawText.match(/(?:CAUS|RI|INF)\s*[:\-]?\s*(?:RI\s*[:\-]?)?\s*(.+)$/i);
        if (causMatch) {
            reason = causMatch[1]
                .replace(/Estratto Conto.*/gi, '')
                .replace(/Siena:.*$/gi, '')
                .replace(/n\.\d+Mod\..*$/gi, '')
                .replace(/BEN\.FIN:.*$/gi, '')
                .replace(/\b[A-Z]{4}IT[A-Z0-9]{2,}\b/gi, '') // Rimuove eventuali BIC/IBAN nel testo
                .replace(/^\d{3}\s+/, '') // Rimuove prefissi numerici tecnici (es. 048) all'inizio
                .replace(/^(?:RI|EE|CAUS|CASH)\s*[:\-]?\s*/i, '')
                .replace(/[A-Fa-f0-9]{32,}/g, '') // Rimuove hash UUID-like (Vinted)
                .replace(/CAUS:\s*CASH/gi, '') // Rimuove suffisso tecnico
                .replace(/\s+/g, ' ')
                .trim();
                
            // Fix per parole spezzate comuni nei mesi
            reason = reason.replace(/(\w+)\s+(no|ne|na|re)\b/gi, '$1$2')
                           .replace(/NOVE\s*MBRE/gi, 'Novembre')
                           .replace(/OTTO\s*BRE/gi, 'Ottobre')
                           .replace(/DICE\s*MBRE/gi, 'Dicembre')
                           .replace(/GENN\s*AIO/gi, 'Gennaio');
        }
        
        if (donor && donor.length > 2) cleanDesc = `Bonifico da ${toTitleCase(donor)}${reason ? ' - ' + reason : ''}`;
        else if (reason) cleanDesc = `Bonifico - ${reason}`;
        else if (normalizedUp.includes('BONIFICO')) cleanDesc = 'Bonifico in entrata';
    }
    // CASO 5: BONIFICI IN USCITA
    else if (normalizedUp.includes('DISPOSTOTRAMITE') || normalizedUp.includes('AFAVORE') || normalizedUp.includes('BONIFICOSEPA') || /^[Aa]\s+[A-Z]/.test(rawText.trim())) {
        const targetMatch = rawText.match(/(?:\bA\b\s+FAVORE|^A\b)\s*(.*?)(?=\bIBAN\b|\bBIC\b|\bCAUS\b|\bRI\b|:|$)/i);
        let recipient = targetMatch ? targetMatch[1].trim() : '';
        // Pulizia più profonda del destinatario da rimasugli di tag
        recipient = recipient
            .replace(/(?:IBAN|BIC|CAUS|RI|IND|INF).*$/i, '')
            .replace(/\b(?:GMBH|SRL|SPA)\b/gi, '')
            .replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,}\b/g, '') // IBAN orfani
            .trim();
        
        let reason = '';
        const causMatch = rawText.match(/\b(?:CAUS|RI|CAUSALE|RIF)\b\s*[:\-]?\s*(.+)$/i);
        if (causMatch) {
            reason = causMatch[1]
                .replace(/Estratto Conto.*/gi, '')
                .replace(/Siena:.*$/gi, '')
                .replace(/^\d{3}\b\s*/, '') // Rimuove prefissi numerici tecnici (es. 048) anche senza spazio
                .replace(/\s+/g, ' ')
                .trim();
        }
        
        if (recipient && recipient.length > 2) cleanDesc = `Bonifico a ${toTitleCase(recipient)}${reason && reason.length > 1 ? ' - ' + reason : ''}`;
        else if (reason && reason.length > 1) cleanDesc = `Bonifico - ${reason}`;
        else if (normalizedUp.includes('BONIFICO')) cleanDesc = 'Bonifico in uscita';
    }
    // CASO 5: VERSAMENTO CONTANTE (auto/ATM)
    else if (normalizedUp.includes('VERSAMENTOCONTANTE') || normalizedUp.includes('VERSAMENTO CONTANTE') || normalizedUp.includes('SELFSERVICEVERSAMENTO')) {
        cleanDesc = 'Versamento Contante';
    }
    // CASO 6: GIROCONTO FRA CONTI
    else if (normalizedUp.includes('GIROCONTO')) {
        const infMatch = rawText.match(/INF\s*[:\-]?\s*(?:RI\s*[:\-]?)?\s*(.+)$/i);
        let causale = infMatch ? infMatch[1].trim() : '';
        causale = causale.replace(/^RI[:\s]+/i, '').replace(/CAUS:.*$/i, '').trim();
        const ordMatch = rawText.match(/ORD\s*[:\-]?\s*([A-Z][A-Z\s,]+?)(?=\bBIC\b|\bIND\b|\bINF\b|$)/i);
        const donor = ordMatch ? toTitleCase(ordMatch[1].trim().replace(/,$/, '')) : '';
        if (causale) cleanDesc = `Giroconto${donor ? ' da ' + donor : ''} - ${causale}`;
        else if (donor) cleanDesc = `Giroconto da ${donor}`;
        else cleanDesc = 'Giroconto';
    }
    // CASO 7: PRELIEVI BANCOMAT
    else if (normalizedUp.includes('PRELIEVO')) {
        cleanDesc = 'Prelievo ATM';
    }

    // Pulizia finale ulteriore per tag residui che potrebbero essere finiti nella descrizione
    cleanDesc = cleanDesc
        .replace(/BIC:[A-Z0-9]+/, '')
        .replace(/IND:[^RI]*/gi, '')
        .replace(/INF: RI:/gi, '')
        .replace(/[:\-]\s*$/g, '') 
        .replace(/\s+/g, ' ')
        .trim();

    // Applica pulizia universale (rimozione numeri ecc.)
    cleanDesc = this.cleanDescription(cleanDesc);
    cleanDesc = cleanDesc
        .replace(/\b(?:CAUS|RI|RIF|CAUSALE)\b\s*[:\-]?\s*\d{3}\b\s*/gi, '') // Rimuove CAUS 048 ovunque
        .replace(/COMM\.\s*(?:SCT|BON)\s*[\d,.]+/gi, '')
        .replace(/IMP\.\s*INDIV\..*/gi, '')
        .replace(/IMP\.IN DIV\.ORIG.*/gi, '')
        .replace(/SU POS DATA.*/gi, '')
        .replace(/DATA ACCETT.*/gi, '')
        .replace(/\b(?:BIC|IBAN)\b:?\s*\w+/gi, '')
        // Rimuoviamo codici mandato, importi e commissioni residui (solo se seguiti da numeri e/o con colon tecnico)
        .replace(/\b(?:CODICE\s+MANDATO|IMPORTO|COMMISSIONI|SPESE)\s*[:\-]\s*[\d,.]+/gi, '')
        .replace(/\b(?:IMPORTO|COMMISSIONI|SPESE)\b\s*[:\-]\s*[\d,.]+\s*$/gi, '')
        // Rimuoviamo ID lunghi (10+ caratteri), ma solo se contengono ALMENO un numero (per non segare nomi come VOLKSWAGEN)
        .replace(/\b(?=\w*\d)(?=\w*[A-Z])[A-Z0-9]{10,}\b/gi, '')
        // Preserviamo città e dettagli geografici per il categorizzatore
        .replace(/\bIND\b:?\s*.*?(?=CAUS|RI|$)/i, '')
        .replace(/\bINF\b:?\s*\bRI\b:?/gi, '')
        .replace(/\bEE\b:?\s*\d+/gi, '')
        .replace(/\bORA\s+\d{2}\.\d{2}\b/gi, '')
        .replace(/\bDEL\s+\d{2}\s+\d{2}\s+\d{4}\b/gi, '') 
        .replace(/\bDEL\s+\d{2}\/\d{2}\/\d{4}\b/gi, '') 
        .replace(/\bN\.CARTA:?\s*\d*\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

    // Se la pulizia ha svuotato troppo, torniamo a una versione abbreviata e pulita del testo originale
    if (cleanDesc.length < 3) {
        cleanDesc = rawText.replace(/PAGAMENTO MASTERCARD SU POS DATA \d{2}\/\d{2}\/\d{2} ORA \d{2}\.\d{2} LOC\.\w+\s*/i, '')
                          .substring(0, 60).trim();
    }

    if (cleanDesc.includes('SALDO INIZIALE')) return;

    const finalAmount = tx.isIncome ? Math.abs(tx.amount) : -Math.abs(tx.amount);
    
    list.push({
      date: this.normalizeDate(tx.dateStr),
      description: cleanDesc,
      amount: finalAmount,
      originalText: tx.description,
      confidence: 1.0,
      bank: 'Monte dei Paschi'
    });
  }
}

module.exports = MpsParser;



