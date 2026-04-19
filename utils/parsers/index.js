// backend/utils/parsers/index.js
// Registry e orchestratore dei parser bancari

const UniCreditParser = require('./unicreditParser');
const BNLParser = require('./bnlParser');
const FinecoParser = require('./finecoParser');
const RevolutParser = require('./revolutParser');
const N26Parser = require('./n26Parser');
const IntesaSanpaoloParser = require('./intesaParser');
const MpsParser = require('./mpsParser');
const IsybankParser = require('./isybankParser');
const GenericPDFParser = require('./genericPDFParser');

// Registro di tutti i parser disponibili (ordine: più specifici prima, generico ultimo)
const PARSERS = [
  new BNLParser(),
  new IntesaSanpaoloParser(),
  new MpsParser(),
  new UniCreditParser(),
  new IsybankParser(),
  new FinecoParser(),
  new RevolutParser(),
  new N26Parser(),
  new GenericPDFParser()  // Sempre ultimo come fallback
];

/**
 * Seleziona il miglior parser per il contenuto dato
 * @param {string} content - Contenuto del file PDF
 * @returns {Object} - { parser, confidence }
 */
function selectBestParser(content) {
  console.log('🔍 Selecting best parser for content...');
  
  let bestParser = null;
  let bestConfidence = 0;

  for (const parser of PARSERS) {
    const confidence = parser.canParse(content);
    console.log(`  - ${parser.bankName}: confidence ${(confidence * 100).toFixed(0)}%`);
    
    if (confidence > bestConfidence) {
      bestConfidence = confidence;
      bestParser = parser;
    }
  }

  if (!bestParser) {
    console.log('⚠️  No parser found, using generic fallback');
    bestParser = PARSERS[PARSERS.length - 1]; // Generic parser
    bestConfidence = 0.3;
  }

  console.log(`✅ Selected: ${bestParser.bankName} (${(bestConfidence * 100).toFixed(0)}% confidence)`);

  return { parser: bestParser, confidence: bestConfidence };
}

/**
 * Parse PDF bancario con auto-detection
 * @param {string} content - Contenuto del file PDF
 * @returns {Object} - { success, transactions, method, bankFormat, confidence }
 */
function parseBankPDF(content) {
  try {
    // Seleziona miglior parser
    const { parser, confidence } = selectBestParser(content);

    // Esegui parsing
    console.log(`🚀 Starting parsing with ${parser.bankName}...`);
    const transactions = parser.parse(content);

    if (!transactions || transactions.length === 0) {
      return {
        success: false,
        error: 'Nessuna transazione trovata nel PDF',
        method: parser.bankName,
        bankFormat: parser.bankName,
        confidence: confidence
      };
    }

    // Valida tutte le transazioni
    const validTransactions = transactions.filter(t => parser.isValidTransaction(t));

    console.log(`✅ Parsed ${validTransactions.length}/${transactions.length} valid transactions`);

    return {
      success: true,
      transactions: validTransactions,
      method: 'PDF',
      bankFormat: parser.bankName,
      confidence: confidence,
      parserUsed: parser.constructor.name
    };

  } catch (error) {
    console.error('❌ Error parsing PDF:', error);
    return {
      success: false,
      error: error.message,
      method: 'PDF',
      bankFormat: 'Unknown',
      confidence: 0
    };
  }
}

/**
 * Registra un nuovo parser
 * @param {BaseBankParser} parser - Istanza del parser da registrare
 */
function registerParser(parser) {
  // Inserisci prima del parser generico (sempre ultimo)
  PARSERS.splice(PARSERS.length - 1, 0, parser);
  console.log(`✅ Registered parser: ${parser.bankName}`);
}

/**
 * Lista tutti i parser disponibili
 * @returns {Array} - Array di nomi parser
 */
function listParsers() {
  return PARSERS.map(p => ({
    name: p.bankName,
    class: p.constructor.name
  }));
}

/**
 * Ottieni statistiche sui parser
 */
function getParserStats() {
  return {
    totalParsers: PARSERS.length,
    parsers: PARSERS.map(p => p.bankName),
    genericFallback: PARSERS[PARSERS.length - 1].bankName
  };
}

module.exports = {
  parseBankPDF,
  selectBestParser,
  registerParser,
  listParsers,
  getParserStats,
  PARSERS
};