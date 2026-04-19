// utils/fileParser.js - VERSIONE AGGIORNATA CON SISTEMA MODULARE

const fs = require('fs').promises;
const path = require('path');
const pdfParse = require('pdf-parse');
const xlsx = require('xlsx');

// 🆕 Import del sistema modulare
const { parseBankPDF, getParserStats } = require('./parsers');

// 🆕 Import parser CSV specifici per banca
const FinecoParser = require('./parsers/finecoParser');
const RevolutParser = require('./parsers/revolutParser');
const N26Parser = require('./parsers/n26Parser');
const IntesaSanpaoloParser = require('./parsers/intesaParser');
const { intelligentNoiseRemoval } = require('./ultimateCategorizer');

/**
 * Parser principale migliorato con sistema modulare
 */
async function parseFile(filePath, originalName, mimeType) {
  console.log(`📄 Parsing file: ${originalName}, type: ${mimeType}`);
  
  try {
    const extension = path.extname(originalName).toLowerCase();
    let result = null;

    // Routing basato su estensione
    switch (extension) {
      case '.pdf':
        result = await parsePDF(filePath);
        break;
      case '.csv':
        result = await parseCSV(filePath);
        break;
      case '.xlsx':
      case '.xls':
        result = await parseExcel(filePath);
        break;
      case '.txt':
        result = await parseTXT(filePath);
        break;
      case '.json':
        result = await parseJSON(filePath);
        break;
      case '.qif':
        result = await parseQIF(filePath);
        break;
      case '.ofx':
      case '.qfx':
        result = await parseOFX(filePath);
        break;
      case '.mt940':
      case '.sta':
        result = await parseMT940(filePath);
        break;
      default:
        result = await parseByContent(filePath);
    }

    if (result && result.transactions && result.transactions.length > 0) {
      const cleanedTransactions = validateAndCleanTransactions(result.transactions);
      
      if (cleanedTransactions.length === 0) {
        return {
          success: false,
          error: 'Nessuna transazione valida dopo la validazione',
          method: result.method || extension,
          details: `${result.transactions.length} transazioni trovate ma tutte scartate`
        };
      }
      
      const dateRange = getDateRange(cleanedTransactions);
      
      console.log(`✅ Parsed ${cleanedTransactions.length}/${result.transactions.length} valid transactions`);
      
      return {
        success: true,
        transactions: cleanedTransactions,
        method: result.method || extension,
        bankFormat: result.bankFormat || 'Generic',
        dateRange: dateRange,
        originalCount: result.transactions.length,
        validCount: cleanedTransactions.length,
        parserInfo: result.parserUsed || 'Legacy'
      };
    }

    return {
      success: false,
      error: 'Nessuna transazione trovata nel file',
      method: result?.method || extension,
      details: 'Il file potrebbe essere vuoto o in un formato non supportato'
    };

  } catch (error) {
    console.error('❌ Error parsing file:', error);
    return {
      success: false,
      error: error.message,
      method: 'unknown',
      details: error.stack
    };
  }
}

const { parsePDFWithClaude } = require('./claudeCategorizer');

/**
 * 🆕 Parser PDF con sistema modulare e AI Visiva
 */
async function parsePDF(filePath) {
  try {
    const originalName = path.basename(filePath);
    const buffer = await fs.readFile(filePath);

    // 1. Tenta la lettura con AI Visiva (Claude 3.5 Sonnet) se abilitata
    console.log(`📄 PDF: Inizio pipeline di parsing... verifica AI Visiva`);
    try {
      const base64Data = buffer.toString('base64');
      const aiResult = await parsePDFWithClaude(base64Data, originalName);
      
      if (aiResult.success) {
        return {
          transactions: aiResult.transactions,
          method: aiResult.method,
          bankFormat: aiResult.bankFormat,
          confidence: 0.99,
          parserUsed: aiResult.parserUsed
        };
      } else {
        console.log(`⚠️ AI Vision saltata/fallita: ${aiResult.error}. Procedo con fallback testuale.`);
      }
    } catch (aiError) {
      console.log(`⚠️ Errore critico in AI Vision: ${aiError.message}. Procedo con fallback testuale.`);
    }

    // 2. Fallback: Parse testuale con pdf-parse (migliorato per preservare spazi e iniettare coordinate)
    const options = {
      pagerender: (pageData) => {
        return pageData.getTextContent().then(textContent => {
          let lastY, text = '';
          // Ordina per Y decrescente (alto -> basso) e poi per X (sinistra -> destra)
          const items = textContent.items.sort((a, b) => {
            const dy = b.transform[5] - a.transform[5];
            if (Math.abs(dy) < 1.0) return a.transform[4] - b.transform[4];
            return dy;
          });

          for (let item of items) {
            const currentY = item.transform[5];
            const currentX = Math.round(item.transform[4]);

            if (lastY !== undefined && Math.abs(currentY - lastY) < 1.0) {
              // Stessa riga
              text += ' ' + `[${currentX}]` + item.str;
            } else {
              // Nuova riga
              if (text !== '') text += '\n';
              text += `[${currentX}]` + item.str;
            }
            lastY = currentY;
          }
          return text;
        });
      }
    };

    const data = await pdfParse(buffer, options);
    const text = data.text;

    console.log(`📄 PDF Fallback (Structured): ${text.length} caratteri, ${data.numpages} pagine`);
    
    if (text.length < 100) {
      throw new Error('PDF vuoto, protetto o non leggibile');
    }

    // USA IL SISTEMA MODULARE TESTUALE
    const result = parseBankPDF(text);

    if (!result.success) {
      throw new Error(result.error || 'Parsing testuale fallito');
    }

    return {
      transactions: result.transactions,
      method: 'PDF_TextFallback',
      bankFormat: result.bankFormat,
      confidence: result.confidence,
      parserUsed: result.parserUsed
    };

  } catch (error) {
    throw new Error(`Errore PDF: ${error.message}`);
  }
}

/**
 * Parser Excel migliorato
 */
async function parseExcel(filePath) {
  try {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    const jsonData = xlsx.utils.sheet_to_json(worksheet, { 
      header: 1,
      defval: '',
      blankrows: false,
      raw: false
    });
    
    console.log(`📊 Excel: ${jsonData.length} righe, foglio: ${sheetName}`);
    
    if (jsonData.length < 2) {
      throw new Error('File Excel vuoto o con meno di 2 righe');
    }

    const headers = jsonData[0]
      .map(h => h ? h.toString().toLowerCase().trim() : '')
      .filter(h => h.length > 0);
      
    console.log('📋 Headers:', headers);

    const columnMap = detectCSVColumns(headers);
    console.log('🗺️  Column mapping:', columnMap);

    if (!isValidColumnIndex(columnMap.date) || !isValidColumnIndex(columnMap.amount)) {
      throw new Error(
        `Colonne non trovate. Trovate: data=${columnMap.date}, importo=${columnMap.amount}. ` +
        `Headers disponibili: ${headers.join(', ')}`
      );
    }

    const transactions = [];

    for (let i = 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      if (!row || row.length === 0) continue;

      const stringRow = row.map((cell, idx) => {
        if (cell === null || cell === undefined) return '';
        
        if (idx === columnMap.date && typeof cell === 'number' && cell > 25000 && cell < 50000) {
          try {
            const date = xlsx.SSF.parse_date_code(cell);
            return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
          } catch (e) {
            return cell.toString();
          }
        }
        
        return cell.toString().trim();
      });

      try {
        const transaction = extractTransactionFromRow(stringRow, columnMap, row.join(','));
        if (transaction) {
          transactions.push(transaction);
        }
      } catch (e) {
        console.warn(`⚠️  Riga ${i} scartata:`, e.message);
      }
    }

    console.log(`✅ Excel: ${transactions.length} transazioni estratte`);

    return {
      transactions,
      method: 'Excel',
      bankFormat: detectBankFromHeaders(headers)
    };

  } catch (error) {
    console.error('❌ Excel parsing error:', error);
    throw new Error(`Errore Excel: ${error.message}`);
  }
}

/**
 * Parser CSV migliorato
 */
async function parseCSV(filePath) {
  try {
    let content;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch (e) {
      content = await fs.readFile(filePath, 'latin1');
    }
    
    const lines = content.split(/\r?\n/).filter(line => line.trim());
    
    if (lines.length < 2) {
      throw new Error(`File CSV troppo corto: solo ${lines.length} righe`);
    }

    const separator = detectSeparator(lines[0]);
    console.log(`🔍 Separatore rilevato: "${separator}"`);

    const headers = parseCSVLine(lines[0], separator)
      .map(h => h.trim().replace(/^["']|["']$/g, '').toLowerCase());
    
    console.log('📋 Headers CSV:', headers);

    // 🆕 Prova a selezionare un parser bancario specifico
    const specificParser = selectCSVParser(headers);
    
    if (specificParser) {
      console.log(`🏦 Parser specifico selezionato: ${specificParser.bankName}`);
      const columnMap = specificParser.parseCSVHeaders(headers.map((h, i) => {
        // Restore original case for the parser
        const originalHeader = parseCSVLine(lines[0], separator)[i];
        return originalHeader ? originalHeader.trim().replace(/^["']|["']$/g, '') : h;
      }));
      console.log('🗺️  Column mapping (specifico):', columnMap);

      const transactions = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        try {
          const cols = parseCSVLine(line, separator).map(c => c.replace(/^["']|["']$/g, ''));
          const tx = specificParser.parseCSVRow(cols, columnMap);
          if (tx) transactions.push(tx);
        } catch (e) {
          // skip invalid rows silently
        }
      }

      if (transactions.length > 0) {
        console.log(`✅ CSV (${specificParser.bankName}): ${transactions.length} transazioni`);
        return {
          transactions,
          method: 'CSV',
          bankFormat: specificParser.bankName
        };
      }
      console.log(`⚠️  Parser ${specificParser.bankName} non ha trovato transazioni, fallback generico...`);
    }

    // Fallback al parser generico
    const columnMap = detectCSVColumns(headers);
    console.log('🗺️  Column mapping (generico):', columnMap);

    if (!isValidColumnIndex(columnMap.date) || !isValidColumnIndex(columnMap.amount)) {
      throw new Error(
        `Impossibile trovare colonne necessarie.\n` +
        `Trovate: data=${columnMap.date}, importo=${columnMap.amount}, descrizione=${columnMap.description}\n` +
        `Headers: ${headers.join(' | ')}\n` +
        `Assicurati che il CSV abbia colonne per data e importo.`
      );
    }

    const transactions = [];
    const errors = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        const cols = parseCSVLine(line, separator);
        const transaction = extractTransactionFromRow(cols, columnMap, line);
        
        if (transaction) {
          transactions.push(transaction);
        }
      } catch (e) {
        errors.push({ line: i + 1, error: e.message });
        if (errors.length <= 3) {
          console.warn(`⚠️  Riga ${i + 1} scartata: ${e.message}`);
        }
      }
    }

    if (transactions.length === 0 && errors.length > 0) {
      throw new Error(
        `Nessuna transazione valida trovata. Primi errori:\n` +
        errors.slice(0, 3).map(e => `Riga ${e.line}: ${e.error}`).join('\n')
      );
    }

    console.log(`✅ CSV: ${transactions.length} transazioni, ${errors.length} errori`);

    return {
      transactions,
      method: 'CSV',
      bankFormat: detectBankFromHeaders(headers),
      errors: errors.length > 0 ? errors : undefined
    };

  } catch (error) {
    console.error('❌ CSV parsing error:', error);
    throw new Error(`Errore CSV: ${error.message}`);
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function detectSeparator(line) {
  const separators = [',', ';', '\t', '|'];
  let bestSep = ',';
  let maxCount = 0;
  
  for (const sep of separators) {
    const count = (line.match(new RegExp(`\\${sep}`, 'g')) || []).length;
    if (count > maxCount && count > 0) {
      maxCount = count;
      bestSep = sep;
    }
  }
  
  return bestSep;
}

function isValidColumnIndex(index) {
  return typeof index === 'number' && index >= 0;
}

function detectCSVColumns(headers) {
  const map = {};

  const patterns = {
    date: [
      'data', 'date', 'datum', 'fecha', 
      'data operazione', 'data movimento', 'data contabile',
      'data valuta', 'dt', 'transaction date'
    ],
    description: [
      'descrizione', 'description', 'causale', 'memo', 
      'note', 'dettagli', 'operazione', 'narrative',
      'payee', 'beneficiario', 'details'
    ],
    amount: [
      'importo', 'amount', 'valore', 'ammontare', 
      'euro', 'eur', 'somma', 'value', 'total',
      'dare', 'avere', 'addebito', 'accredito'
    ],
    category: ['categoria', 'category', 'tipo', 'type'],
    balance: ['saldo', 'balance', 'disponibile', 'disponibilità']
  };

  for (const [key, variants] of Object.entries(patterns)) {
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i].toLowerCase();
      if (variants.some(v => header === v)) {
        map[key] = i;
        break;
      }
    }
  }

  for (const [key, variants] of Object.entries(patterns)) {
    if (map[key] === undefined) {
      for (let i = 0; i < headers.length; i++) {
        const header = headers[i].toLowerCase();
        if (variants.some(v => header.includes(v) || v.includes(header))) {
          map[key] = i;
          break;
        }
      }
    }
  }

  if (map.date === undefined && headers.length > 0) {
    if (headers[0].length < 15) map.date = 0;
  }
  
  if (map.description === undefined && headers.length > 1) {
    map.description = 1;
  }
  
  if (map.amount === undefined && headers.length > 2) {
    for (let i = 0; i < headers.length; i++) {
      if (/\d|euro|eur|amount|import/i.test(headers[i])) {
        map.amount = i;
        break;
      }
    }
    if (map.amount === undefined) map.amount = 2;
  }

  return map;
}

function parseCSVLine(line, separator) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === separator && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

function extractTransactionFromRow(cols, columnMap, originalLine) {
  if (!cols || cols.length === 0) {
    throw new Error('Riga vuota');
  }

  const dateStr = cols[columnMap.date]?.toString().trim();
  const descriptionStr = cols[columnMap.description]?.toString().trim();
  const amountStr = cols[columnMap.amount]?.toString().trim();

  if (!dateStr) throw new Error('Data mancante');
  if (!descriptionStr) throw new Error('Descrizione mancante');
  if (!amountStr) throw new Error('Importo mancante');

  const date = normalizeDate(dateStr);
  if (!date) throw new Error(`Data non valida: ${dateStr}`);

  const amount = parseAmount(amountStr);
  if (isNaN(amount)) throw new Error(`Importo non valido: ${amountStr}`);
  if (Math.abs(amount) < 0.01) throw new Error('Importo troppo piccolo');

  return {
    date,
    description: cleanDescription(descriptionStr),
    amount,
    originalText: originalLine,
    confidence: 0.9
  };
}

async function parseTXT(filePath) {
  const content = await fs.readFile(filePath, 'utf-8');
  
  const pdfResult = parseBankPDF(content);
  if (pdfResult.success && pdfResult.transactions.length > 0) {
    return {
      transactions: pdfResult.transactions,
      method: 'TXT',
      bankFormat: pdfResult.bankFormat
    };
  }

  let transactions = parseGenericText(content);

  return {
    transactions,
    method: 'TXT',
    bankFormat: 'Text Format'
  };
}

function parseGenericText(content) {
  const transactions = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 10) continue;

    const match = trimmed.match(/(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\s+(.+?)\s+([-+]?\d{1,6}[.,]\d{2})/);
    
    if (match) {
      const date = normalizeDate(match[1]);
      const description = cleanDescription(match[2]);
      const amount = parseAmount(match[3]);

      if (date && description && !isNaN(amount)) {
        transactions.push({
          date,
          description,
          amount,
          originalText: line,
          confidence: 0.7
        });
      }
    }
  }

  return transactions;
}

async function parseJSON(filePath) {
  const content = await fs.readFile(filePath, 'utf-8');
  const data = JSON.parse(content);

  let transactionsArray = Array.isArray(data) ? data : 
    (data.transactions || data.movements || data.operations || []);

  if (!Array.isArray(transactionsArray)) {
    throw new Error('JSON non contiene array di transazioni');
  }

  const transactions = [];

  for (const item of transactionsArray) {
    const date = item.date || item.data || item.timestamp;
    const description = item.description || item.descrizione || item.memo;
    const amount = item.amount || item.importo || item.value;

    if (date && description && amount !== undefined) {
      transactions.push({
        date: normalizeDate(date.toString()),
        description: cleanDescription(description.toString()),
        amount: parseFloat(amount),
        originalText: JSON.stringify(item),
        confidence: 0.8
      });
    }
  }

  return {
    transactions,
    method: 'JSON',
    bankFormat: 'JSON Export'
  };
}

async function parseQIF(filePath) {
  const content = await fs.readFile(filePath, 'utf-8');
  const transactions = [];
  const lines = content.split('\n');
  let currentTransaction = {};

  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed.startsWith('D')) {
      currentTransaction.date = normalizeQIFDate(trimmed.substring(1));
    } else if (trimmed.startsWith('T')) {
      currentTransaction.amount = parseFloat(trimmed.substring(1));
    } else if (trimmed.startsWith('P') || trimmed.startsWith('M')) {
      currentTransaction.description = trimmed.substring(1);
    } else if (trimmed === '^') {
      if (currentTransaction.date && currentTransaction.amount && currentTransaction.description) {
        transactions.push({
          date: currentTransaction.date,
          description: cleanDescription(currentTransaction.description),
          amount: currentTransaction.amount,
          originalText: JSON.stringify(currentTransaction),
          confidence: 0.9
        });
      }
      currentTransaction = {};
    }
  }

  return { transactions, method: 'QIF', bankFormat: 'Quicken QIF' };
}

async function parseOFX(filePath) {
  const content = await fs.readFile(filePath, 'utf-8');
  const transactions = [];

  const transactionRegex = /<STMTTRN>(.*?)<\/STMTTRN>/gs;
  const matches = content.match(transactionRegex);

  if (matches) {
    for (const match of matches) {
      const dateMatch = match.match(/<DTPOSTED>(\d{8})/);
      const amountMatch = match.match(/<TRNAMT>([-\d\.]+)/);
      const memoMatch = match.match(/<MEMO>(.*?)</);
      const nameMatch = match.match(/<NAME>(.*?)</);

      if (dateMatch && amountMatch) {
        const date = dateMatch[1];
        const formattedDate = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
        const amount = parseFloat(amountMatch[1]);
        const description = memoMatch?.[1] || nameMatch?.[1] || 'Transazione OFX';

        transactions.push({
          date: formattedDate,
          description: cleanDescription(description),
          amount,
          originalText: match,
          confidence: 0.9
        });
      }
    }
  }

  return { transactions, method: 'OFX', bankFormat: 'OFX/QFX Format' };
}

async function parseMT940(filePath) {
  const content = await fs.readFile(filePath, 'utf-8');
  const transactions = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (line.startsWith(':61:')) {
      const data = line.substring(4);
      const dateStr = data.substring(0, 6);
      const year = '20' + dateStr.substring(0, 2);
      const month = dateStr.substring(2, 4);
      const day = dateStr.substring(4, 6);
      const formattedDate = `${year}-${month}-${day}`;
      
      const amountMatch = data.match(/([CD])([\d,\.]+)/);
      if (amountMatch) {
        const isCredit = amountMatch[1] === 'C';
        let amount = parseFloat(amountMatch[2].replace(',', '.'));
        if (!isCredit) amount = -amount;
        
        let description = 'Transazione MT940';
        if (i + 1 < lines.length && lines[i + 1].startsWith(':86:')) {
          description = lines[i + 1].substring(4);
        }
        
        transactions.push({
          date: formattedDate,
          description: cleanDescription(description),
          amount,
          originalText: line,
          confidence: 0.8
        });
      }
    }
  }

  return { transactions, method: 'MT940', bankFormat: 'SWIFT MT940' };
}

async function parseByContent(filePath) {
  const content = await fs.readFile(filePath, 'utf-8');
  
  if (content.includes(',') && content.includes('\n')) {
    return await parseCSV(filePath);
  } else if (content.match(/\d{2}[\/\-]\d{2}[\/\-]\d{4}/)) {
    return await parseTXT(filePath);
  } else if (content.startsWith('{') || content.startsWith('[')) {
    return await parseJSON(filePath);
  }
  
  throw new Error('Formato file non riconosciuto');
}

function normalizeDate(dateStr) {
  if (!dateStr) return null;
  
  const cleanDate = dateStr.toString().trim();
  
  if (/^\d{10,13}$/.test(cleanDate)) {
    const timestamp = parseInt(cleanDate);
    const date = new Date(timestamp > 10000000000 ? timestamp : timestamp * 1000);
    return date.toISOString().split('T')[0];
  }
  
  let match;
  
  if ((match = cleanDate.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/))) {
    const [, day, month, year] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  if ((match = cleanDate.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/))) {
    const [, year, month, day] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  if ((match = cleanDate.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2})$/))) {
    const [, day, month, year] = match;
    const fullYear = parseInt(year) > 50 ? `19${year}` : `20${year}`;
    return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  return null;
}

function normalizeQIFDate(dateStr) {
  const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (match) {
    const [, month, day, year] = match;
    const fullYear = year.length === 2 ? 
      (parseInt(year) > 50 ? `19${year}` : `20${year}`) : year;
    return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return dateStr;
}

function parseAmount(amountStr) {
  if (!amountStr) return 0;
  
  let cleanAmount = amountStr.toString().replace(/[€$£\s]/g, '');
  
  const isNegative = cleanAmount.includes('-') || 
                   (cleanAmount.includes('(') && cleanAmount.includes(')'));
  
  cleanAmount = cleanAmount.replace(/[-+()]/g, '');
  
  const lastComma = cleanAmount.lastIndexOf(',');
  const lastDot = cleanAmount.lastIndexOf('.');
  
  if (lastComma > lastDot) {
    cleanAmount = cleanAmount.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    cleanAmount = cleanAmount.replace(/,/g, '');
  }
  
  const amount = parseFloat(cleanAmount);
  return isNaN(amount) ? 0 : (isNegative ? -Math.abs(amount) : amount);
}

function cleanDescription(description) {
  return intelligentNoiseRemoval(description);
}

function validateAndCleanTransactions(transactions) {
  const validTransactions = [];
  const seenTransactions = new Set();
  
  for (const trans of transactions) {
    if (!trans.date || !trans.description || trans.amount === undefined) {
      continue;
    }
    
    const date = new Date(trans.date);
    if (isNaN(date.getTime())) {
      console.log(`[VALIDATION-DEBUG] Missing/Invalid Date: ${JSON.stringify(trans)}`);
      continue;
    }
    
    const amount = parseFloat(trans.amount);
    if (isNaN(amount) || Math.abs(amount) < 0.01) {
      console.log(`[VALIDATION-DEBUG] Invalid Amount: ${JSON.stringify(trans)}`);
      continue;
    }
    
    // ✅ Firma completa per evitare collisioni su transazioni simili ma distinte
    const signature = `${trans.date}-${trans.description}-${amount}-${trans.originalText}`;
    if (seenTransactions.has(signature)) {
      console.log(`[VALIDATION-DEBUG] Duplicate Signature: ${signature}`);
      continue;
    }
    seenTransactions.add(signature);
    
    validTransactions.push({
      date: trans.date,
      description: cleanDescription(trans.description),
      amount: Math.round(amount * 100) / 100,
      originalText: trans.originalText,
      confidence: trans.confidence || 0.5
    });
  }
  
  validTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));
  
  return validTransactions;
}

function getDateRange(transactions) {
  if (transactions.length === 0) return null;
  
  const dates = transactions.map(t => t.date).sort();
  return `${dates[0]} to ${dates[dates.length - 1]}`;
}

function detectBankFromHeaders(headers) {
  const headerStr = headers.join(' ').toLowerCase();
  
  const bankPatterns = {
    'Intesa Sanpaolo': ['intesa', 'sanpaolo'],
    'Fineco Bank': ['fineco'],
    'Revolut': ['revolut', 'started date', 'payment reference'],
    'N26': ['n26', 'payee', 'account number'],
    'UniCredit': ['unicredit'],
    'BNL': ['bnl'],
    'Poste Italiane': ['poste', 'bancoposta'],
    'Banco BPM': ['bpm', 'banco'],
    'BPER': ['bper'],
    'Mediolanum': ['mediolanum']
  };
  
  for (const [bank, keywords] of Object.entries(bankPatterns)) {
    if (keywords.some(k => headerStr.includes(k))) {
      return bank;
    }
  }
  
  return 'Generic CSV';
}

/**
 * Seleziona il parser CSV specifico per la banca rilevata dagli headers
 */
function selectCSVParser(headers) {
  const headerStr = headers.join(' ').toLowerCase();
  
  const CSV_PARSERS = [
    new RevolutParser(),
    new N26Parser(),
    new FinecoParser(),
    new IntesaSanpaoloParser(),
  ];

  for (const parser of CSV_PARSERS) {
    const confidence = parser.canParse(headerStr);
    if (confidence > 0.4) {
      return parser;
    }
  }
  return null;
}

function getParserInfo() {
  return getParserStats();
}

// EXPORTS
module.exports = {
  parseFile,
  normalizeDate,
  parseAmount,
  cleanDescription,
  getParserInfo
};