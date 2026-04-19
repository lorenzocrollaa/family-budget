const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { quickCategorizeMerchant } = require('./claudeCategorizer');

/**
 * 🏷️ 1. MAPPA KEYWORDS LOCALE (MOLTO ESTESA)
 * Per instradamento veloce e accurato senza chiamate AI
 */
const CATEGORIES_MAP = {
  // Stipendio PRIMA di Bonifico: "BONIFICO STIPENDIO" → Stipendio, non Bonifico
  'Stipendio': [
    'STIPENDIO', 'EMOLUMENTI', 'PENSIONE', 'ACCREDITO STIPENDIO', 'SALARIO', 'BONIFICO DA AZIENDA', 'ACCREDITO SALARIO'
  ],
  'Bonifico': [
    'BONIFICO', 'SCTINST', 'BONIFICO DA', 'BONIFICO PER', 'SCT', 'GIROCONTO'
  ],
  'Commissioni Bancarie': [
    'COMMISSIONI', 'SPESE TENUTA', 'INTERESSI', 'CANONE', 'BOLLO', 'COSTO OPERATIVO', 
    'NEXI', 'MASTERCARD', 'VISA', 'AMERICAN EXPRESS', 'AMEX', 'SIPE', 'COMMISSIONE',
    'UTILIZZO CREDITO', 'QUOTA ASSOCIATIVA', 'COMMISSIONE SUL'
  ],
  'Prelievi': [
    'BANCOMAT', 'PRELIEVO', 'ATM'
  ],
  'Paghetta': [
    'PAGHETTA', 'MANCETTA', 'REGALO RAGAZZI', 'KIDS', 'MANCIA'
  ],
  'Alimentari': [
    'COOP', 'ESSELUNGA', 'CONAD', 'CARREFOUR', 'LIDL', 'MD', 'EUROSPIN', 'CRAI', 'SIGMA', 'FAMILA', 
    'ALDI', 'PENNY MARKET', 'IL GIGANTE', 'TIGROS', 'TODIS', 'INCOOP', 'IPERCOOP', 'BENNET', 'IL CASTORO', 
    'TUODI', 'GULLIVER', 'SUPERMERCATO', 'MARKET', 'MACELLERIA', 'PANIFICIO', 'FRUTTERIA', 'PESCHERIA', 
    'GASTRONOMIA', 'ALIMENTARI', 'EATALY', 'NATURASI', 'TIGOTA', 'SAPONI', 'ACQUA E SAPONE', 'RISPARMIO CASA', 
    'MAURYS', 'IPER', 'PAM', 'PANORAMA', 'AUCHAN', 'DESPAR', 'EUROSPAR', 'INTERSPAR', 'ARD DISCOUNT', 'DICO',
    'SISA', 'A E O', 'GROS', 'DECÒ', 'SPAK', 'ALI', 'ALIPER', 'BASKO', 'GALA', 'TODIS', 'PEWEX', 'ELITE', 
    'TIGRE', 'POLO', 'IPERSIMPLY', 'SIMPLY', 'PUNTO SMA', 'SMA', 'AUCHAN', 'MY AUCHAN'
  ],
  'Ristoranti': [
    'RISTORANTE', 'PIZZERIA', 'BAR', 'CAFFE', 'GELATERIA', 'PUB', 'TRATTORIA', 'OSTERIA', 'MCDONALD', 
    'BURGER KING', 'KFC', 'SUSHI', 'POKE', 'ROADHOUSE', 'OLD WILD WEST', 'ROSSOPOMODORO', 'LA PIADINERIA', 
    'DOMINOS', 'ALICE PIZZA', 'STARBUCKS', 'GROM', 'VENCHI', 'DELIVEROO', 'JUST EAT', 'GLOVO', 'UBER EATS', 
    'THE FORK', 'PANINO GIUSTO', 'SPONTINI', 'LOWENGORUBE', 'FOOD', 'LUNCH', 'DINNER', 'KIKU', 'TENOHA', 
    'PESCARIA', 'MISOSHI', 'WOK', 'GOURMET', 'TAKEAWAY', 'BAKERY', 'PASTICCERIA', 'TAVERNA', 'ENOTECA', 'LOCANDA',
    'CANTINA', 'BISTROT', 'WINE', 'BIRRERIA', 'KEBAB', 'HAMBURGER', 'STEAK', 'GRILL', 'TAVOLA CALDA', 'ROSTICCERIA'
  ],
  'Trasporti': [
    'ENI', 'Q8', 'IP', 'REPSOL', 'TOTAL', 'TAMOIL', 'ESSO', 'API', 'KUWAIT', 'AUTOGRILL', 'CHEF EXPRESS',
    'TELEPASS', 'UNIPOLMOVE', 'AUTOSTRADE', 'PARCHEGGIO', 'EASYPARK', 'MYCICERO', 'TAXI', 'UBER', 'FREENOW',
    'WETAXI', 'TRENITALIA', 'ITALO', 'TRENORD', 'FRECCIAROSSA', 'EASYJET', 'RYANAIR', 'WIZZAIR', 'LUFTHANSA',
    'ITA AIRWAYS', 'VOLOTEA', 'METRO', 'BUS', 'ATAC', 'ATM MILANO', 'GTT', 'COTRAL', 'AMAT', 'RENTAL', 'AVIS',
    'HERTZ', 'EUROPCAR', 'SHARENOW', 'ENJOY', 'TIER', 'LIME', 'DOTT', 'BENZINA', 'DIESEL', 'DISTRIBUTORE',
    'CARBURANTE', 'AUTONOLEGGIO', 'BIGLIETTERIA FS', 'STAZIONE', 'AEREOPORTO', 'MOBILITY', 'VUELING', 'ALITALIA',
    'BRITISH AIRWAYS', 'AIR FRANCE', 'PARK', 'GARAGE', 'ZTL', 'MUVIN'
    // BOOKING e AIRBNB rimossi: appartengono a Viaggi, non Trasporti
    // GAS rimosso: le stazioni di servizio già identificate per brand (Q8, ENI ecc.)
  ],
  'Salute': [
    'FARMACIA', 'PARAFARMACIA', 'MEDICINA', 'OSPEDALE', 'CLINICA', 'DENTISTA', 'OCULISTA', 'OTTICA', 
    'SALMOIRAGHI', 'VISIONOTTICA', 'VISIONOTICA', 'GRANDVISION', 'LABORATORIO', 'ANALISI', 'MEDICO', 'POLICLINICO', 
    'CROCE ROSSA', 'SYNLAB', 'CENTRO MEDICO', 'SANITARIA', 'FISIOTERAPISTA', 'PEDIATRA', 'GINECOLOGO',
    'ORTOPEDICO', 'DERMATOLOGO', 'PSICOLOGO', 'STUDIO MEDICO', 'CUP', 'DIAGNOSTICA', 'POLIAMBULATORIO', 
    'CENTRO DIAGNOSTICO', 'PRELIEVI', 'VISITA', 'TERAPIA', 'OCULISTA', 'OTTICO', 'VISION OPTIKA', 'VISIONOTTICA'
  ],
  'Bollette': [
    'TIM', 'TELECOM', 'VODAFONE', 'WIND', 'WINDTRE', 'ILIAD', 'FASTWEB', 'TISCALI', 'POSTEMOBILE',
    'HO MOBILE', 'KENA', 'ENEL', 'SERVIZIO ELETTRICO', 'EDISON', 'A2A', 'HERA', 'IREN', 'ENI PLENITUDE',
    'ACEA', 'SORGENIA', 'EON', 'ILLUMIA', 'LUCE', 'GAS', 'ACQUA', 'RIFIUTI', 'TARI', 'CANONE TV', 'RAI',
    'INTERNET', 'FIBRA', 'BOLLETTINO', 'AMSA', 'AMA ROMA', 'SMAT', 'ACQUEDOTTO', 'TPL', 'VIVI ENERGIA', 'ENGIE', 'NEVA',
    'EOLO', 'LINKEM'
    // SKY e DAZN rimossi: appartengono a Intrattenimento, non utility
  ],
  'Shopping': [
    'ZARA', 'H&M', 'BERSHKA', 'PULL&BEAR', 'STRADIVARIUS', 'MANGO', 'OVS', 'UPIM', 'COIN', 'RINASCENTE',
    'PRIMARK', 'BENETTON', 'SISLEY', 'INTIMISSIMI', 'CALZEDONIA', 'TEZENIS', 'YAMAMAY', 'GUESS', 'CALVIN KLEIN',
    'LEVIS', 'DIESEL', 'ARMANI', 'GUCCI', 'PRADA', 'YOOX', 'ZALANDO', 'ASOS', 'SHEIN', 'VINTED', 'NIKE',
    'ADIDAS', 'PUMA', 'FOOT LOCKER', 'AW LAB', 'SCARPE', 'ABBIGLIAMENTO', 'BOUTIQUE', 'GIOIELLERIA', 'PANDORA',
    'SWAROVSKI', 'PIQUADRO', 'CARPISA', 'BATA', 'GEOX', 'PITTARELLO', 'DECATHLON', 'KYS', 'GIOCATTOLI',
    'TABACCHI', 'VALIGERIA', 'ACCESSORI'
    // LIBRERIA e CARTOLERIA → Educazione; PROFUMERIA → Benessere
  ],
  'Casa': [
    'IKEA', 'LEROY MERLIN', 'BRICO', 'OBI', 'BRICOMAN', 'TECNOMAT', 'MAISONS DU MONDE', 'ZARA HOME', 
    'KASANOVA', 'EMMELUNGA', 'MONDO CONVENIENZA', 'CHATEAU DAX', 'POLTRONESOFA', 'FERRAMENTA', 'CASALINGHI', 
    'ELETTRODOMESTICI', 'DYSON', 'VORWERK', 'FOLLETTO', 'NESPRESSO', 'LAVAZZA', 'BIALETTI', 'ARREDAMENTO'
  ],
  'Sport': [
    'CISALFA', 'DF SPORT SPECIALIST', 'NON SOLO SPORT', 'PALESTRA', 'VIRGIN ACTIVE', 'MCFIT', 
    'FITACTIVE', 'ANYTIME FITNESS', 'PISCINA', 'CALCIO', 'TENNIS', 'PADEL', 'SPORTING', 'GOLF', 'FITNESS', 
    'GYM', 'CROSSFIT', 'YOGA', 'PILATES', 'SCI', 'CENTRO SPORTIVO', 'CAMPO', 'STADIO'
  ],
  'Benessere': [
    'SEPHORA', 'DOUGLAS', 'MARIONNAUD', 'KIKO', 'CAPELLO POINT', 'PARRUCCHIERE', 'BARBIERE', 'ESTETISTA',
    'CENTRO ESTETICO', 'CENTRO SPA', 'TERME', 'MASSAGGIO', 'NAILS', 'JEAN LOUIS DAVID', 'FRANCK PROVOST', 'BEAUTY',
    'SALONE', 'HAIR', 'PROFUMERIA', 'COSMETICS', 'SOLARIUM', 'TAGLIO', 'WELLNESS', 'HAMMAM'
    // SPA rimosso: troppo ambiguo con suffisso societario "S.p.A." nelle descrizioni originali
    // Rimane CENTRO SPA come pattern più specifico
  ],
  'Tecnologia': [
    'APPLE', 'AMAZON', 'MEDIAWORLD', 'UNIEURO', 'EURONICS', 'EXPERT', 'TRONY', 'COMET', 'MONCLICK', 'EPRICE', 
    'COMPUTER', 'ELETTRONICA', 'SOFTWARE', 'MICROSOFT', 'GOOGLE', 'PLAYSTATION', 'NINTENDO', 'STEAM', 'ADOBE', 
    'AWS', 'ARUBA', 'REGISTER', 'HOSTING', 'DIGITAL', 'ELECTRONICS', 'INFORMATICA'
  ],
  'Intrattenimento': [
    'NETFLIX', 'SPOTIFY', 'DISNEY', 'PRIME VIDEO', 'DAZN', 'SKY', 'NOW TV', 'INFINITY', 'YOUTUBE', 'CINEMA', 
    'UCI CINEMAS', 'THE SPACE', 'TEATRO', 'MUSEO', 'CONCERTO', 'TICKETONE', 'TICKETMASTER', 'VIVATICKET', 
    'LUDOTECA', 'GIOCO', 'PLAYSTORE', 'APP STORE', 'GIOCHERIA', 'TOYS CENTER', 'APPLE SERVICES', 'MOSTRE', 'STADIO',
    'AUDITORIUM', 'MOSTRA', 'EVENTO', 'DISCOTECA'
  ],
  'Educazione': [
    'SCUOLA', 'UNIVERSITA', 'MONDADORI', 'FELTRINELLI', 'LIBRACCIO', 'GIUNTI', 'CARTOLERIA', 'CORSO', 'MASTER', 
    'RETTA', 'ASILO', 'UDEMY', 'COURSERA', 'DUOLINGO', 'BABBEL', 'LIBRERIA', 'NIDO', 'MIP', 'BOCCONI', 'POLITECNICO',
    'FORMAZIONE', 'LEZIONE', 'TUTOR'
  ],
  'Acquisti Online': [
    'PAYPAL', 'SATISPAY', 'SCALAPAY', 'KLARNA', 'ALIEXPRESS', 'TEMU', 'WISH', 'EBAY', 'SUBITO', 'AMZN', 'VINTED'
  ],
  'Viaggi': [
    'HOTEL', 'BOOKING', 'AIRBNB', 'VIAGGIO', 'TRIP', 'TRAVEL', 'LODGING', 'HOLIDAY',
    'EXPEDIA', 'AGODA', 'TRIVAGO', 'HOSTEL', 'RESORT'
  ],
  'Altre Spese': [
    'DISTRIBUZIONE', 'VARIE', 'ALTRO', 'CASH'
  ]
};

// Keyword che richiedono strict word-boundary: corte, ambigue, o sigle societarie
const DANGER_LIST = [
  'BAR', 'PUB', 'SPA', 'GAS', 'LUCE', 'TAXI', 'MD', 'PAM', 'Q8', 'IP', 'API', 'GTT', 'TIM', 'ENI', 'OBI', 'ALI', 'DICO',
  'FOOD', 'WINE', 'MARKET', 'PARK', 'BUS', 'GYM', 'SKY', 'SCI', 'WOK', 'RAI', 'EOS'
];

const COMPILED_REGEX_MAP = {};
for (const [category, keywords] of Object.entries(CATEGORIES_MAP)) {
  COMPILED_REGEX_MAP[category] = keywords.map(kw => {
    const trimmedKw = kw.trim();
    const safeKw = trimmedKw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Se la keyword è corta (<= 4) o potenzialmente rischiosa -> Strict Boundary
    if (trimmedKw.length <= 4 || DANGER_LIST.includes(trimmedKw)) {
      return new RegExp(`(?:^|[^\\p{L}\\p{N}_])${safeKw}(?:[^\\p{L}\\p{N}_]|$)`, 'iu');
    } else {
      // Per i brand lunghi e unici -> match in stringa continua (intercetta CALZEDONIA0123)
      return new RegExp(`${safeKw}`, 'iu');
    }
  });
}

/**
 * 🧹 PULIZIA INTELLIGENTE (DI LIVELLO 1 - Visuale e Base)
 * Non deve essere distruttiva per permettere al categorizzatore di vedere i dettagli.
 */
function intelligentNoiseRemoval(description) {
  if (!description) return '';
  let cleaned = description.trim()
    .replace(/\[#\d+\]/g, '')
    .replace(/\[\d+\]/g, '')
    // RIMOZIONE HEADER CONCATENATO ULTIMATE
    .replace(/^\s*(?:\d{2}\/\d{2}\/\d{4}\s*)+(?:\d{1,3}\s*)?/, '')
    .replace(/\b\d{2}\s*Pag\s*(?:MAESTRO|VISA|CARTA|MASTERCARD)\b/gi, '')
    .replace(/\b\d{2}[:\.]\d{2}\b/g, '')
    .replace(/\b\d{2}[\.\/\-]\d{2}[\.\/\-]\d{2,4}\b/g, '')
    // BOILERPLATE LEGALE BNL
    .replace(/Banca Nazionale del Lavoro spa.*/gi, '')
    .replace(/Sede legale e direzione generale.*/gi, '')
    .replace(/iscritto all[\’'].*/gi, '')
    .replace(/Albo delle banche.*/gi, '')
    .replace(/(\- )?tta all[\’'].*/gi, '')
    .replace(/presso la Banca d.Italia.*/gi, '')
    .replace(/Gruppo BNP Paribas.*/gi, '')
    // RIMOZIONE SIGLE SOCIETARIE (Solo la sigla, non il testo successivo)
    .replace(/\s+(?:S\.?R\.?L\.?|S\.?P\.?A\.?|S\.?N\.?C\.?|S\.?A\.?S\.?|S\.?R\.?L\.?S\.?|S\.?S\.?|COOP|S\.?C\.?A\.?R\.?L\.?|B\.?V\.?)\b/gi, ' ')
    .replace(/\s+[A-Z]\s*$/g, ' ') 
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned;
}

const { lookupMerchant } = require('./googlePlacesService');

/**
 * 🎯 CATEGORIZZAZIONE ULTIMATE (DOPPIO LIVELLO: CONTESTO + DISPLAY)
 */
async function categorizeUltimate(transaction, userId) {
  const description = transaction.description;
  const originalText = transaction.originalText || description;
  const amount = parseFloat(transaction.amount);
  const upOriginal = originalText.toUpperCase();
  
  if (!description) return { category: 'Altre Spese', confidence: 0 };
  
  const cleanName = intelligentNoiseRemoval(description);
  const upName = cleanName.toUpperCase();
  
  console.log(`\n🔍 [Categorizer] Analisi Context: "${originalText.substring(0, 100)}..."`);
  console.log(`🧹 [Categorizer] Nome Display: "${cleanName}" (${amount}€)`);

  // --- STAGE 0: PRIORITA' "STATO" (Rimborso, Commissione, Storno) ---
  // Guardiamo il testo ORIGINALE per non perdere indizi dai parser
  if (upOriginal.includes('RIMBORSO') || upOriginal.includes('REVERSAL') || upOriginal.includes('STORNO')) {
      console.log(`💎 [Categorizer] STAGE 0: Rilevato Rimborso/Storno nel testo originale.`);
      return { category: amount > 0 ? 'Entrate Varie' : 'Altre Spese', confidence: 0.99, reason: 'Refund/Reversal status detected' };
  }

  if (upOriginal.includes('UTILIZZO CREDITO') || upOriginal.includes('COMMISSIONE') || upOriginal.includes('SPESE TENUTA')) {
      console.log(`🏦 [Categorizer] STAGE 0: Rilevato costo bancario tecnico.`);
      return { category: 'Commissioni Bancarie', confidence: 0.99, reason: 'Bank fee status detected' };
  }

  // STAGE 0.2: PRIORITA' PAGHETTA
  if (upOriginal.includes('PAGHETTA') || upOriginal.includes('MANCETTA')) {
      return { category: 'Paghetta', confidence: 0.99, reason: 'Kid Allowance detected' };
  }

  // STAGE 0.3: PRIORITA' STIPENDIO (prima che "BONIFICO" possa intercettarlo in Stage 3)
  if (upOriginal.includes('STIPENDIO') || upOriginal.includes('SALARIO') || upOriginal.includes('EMOLUMENTI') || upOriginal.includes('ACCREDITO STIPENDIO')) {
      return { category: 'Stipendio', confidence: 0.99, reason: 'Salary/income signal in original text' };
  }

  // --- STAGE 1: MERCHANT CACHE (MEMORIA UTENTE) - CASE INSENSITIVE ---
  try {
    const cached = await prisma.merchantCache.findUnique({
      where: { merchantName: cleanName.toUpperCase() }
    });
    if (cached) {
      console.log(`🧠 [Categorizer] STAGE 1: Cache Match! ${cached.category}`);
      return { category: cached.category, confidence: 0.99, reason: 'User Memory' };
    }
  } catch (e) {}

  // --- STAGE 2: LEARNED KEYWORDS ---
  try {
    const learnedKeywords = await prisma.categoryKeyword.findMany({
      where: { userId: userId },
      orderBy: { weight: 'desc' }
    });
    
    for (const lk of learnedKeywords) {
      const regex = new RegExp(`\\b${lk.keyword}\\b`, 'i');
      if (regex.test(upOriginal)) { // Cerchiamo nell'originale per più contesto
        console.log(`🎓 [Categorizer] STAGE 2: Keyword Appresa: "${lk.keyword}" -> ${lk.category}`);
        return { category: lk.category, confidence: 0.9, reason: `Learned: ${lk.keyword}` };
      }
    }
  } catch (e) {}

  // --- STAGE 3: LOCAL KEYWORDS + EURISTICHE CONTESTUALI (L'INTELLIGENZA) ---
  
  for (const [category, regexes] of Object.entries(COMPILED_REGEX_MAP)) {
    for (let i = 0; i < regexes.length; i++) {
        if (regexes[i].test(upOriginal)) {
            let finalCategory = category;
            
            console.log(`🏷️ [Categorizer] STAGE 3: Match Keyword: "${CATEGORIES_MAP[category][i]}" -> ${finalCategory}`);
            return { category: finalCategory, confidence: 0.95, reason: `Local Context: ${CATEGORIES_MAP[category][i]}` };
        }
    }
  }

  // --- STAGE 4: GOOGLE PLACES FALLBACK ---
  if (process.env.GOOGLE_PLACES_ENABLED === 'true') {
     try {
       console.log(`🌐 [Categorizer] STAGE 4: Chiedo a Google Places per "${cleanName}"...`);
       const googleResult = await lookupMerchant(description, null, userId);
       if (googleResult && googleResult.found) {
         return { category: googleResult.category, confidence: 0.9, reason: `Google Places: ${googleResult.googleType}` };
       }
     } catch (err) {}
  }

  // FALLBACK FINALE
  const fallbackCat = amount > 0 ? 'Entrate Varie' : 'Altre Spese';
  console.log(`🤷 [Categorizer] Fallback: ${fallbackCat}`);
  return { category: fallbackCat, confidence: 0.1, reason: 'Unknown signature' };
}

/**
 * 🛠️ ESTRAZIONE KEYWORDS PER APPRENDIMENTO
 */
function extractKeywords(description) {
  if (!description) return [];
  
  // Rimuovi rumore e numeri civici/date
  const clean = intelligentNoiseRemoval(description).toLowerCase();
  
  // Dividi in parole, ignora connettivi e parole corte
  // 🛑 STOP WORDS: Lista estesa per evitare apprendimento di "rumore"
  const stopWords = [
    // Connettivi e articoli (Italiano e Inglese)
    'di', 'da', 'in', 'con', 'per', 'su', 'tra', 'fra', 'a', 'la', 'il', 'lo', 'le', 'gli', 'del', 'della', 'al', 'alla', 'dal', 'dalla', 'col', 'coi', 'sul', 'sulla', 'e', 'o', 'the', 'of', 'and', 'with', 'from', 'for', 'at', 'to', 'in', 'on', 'by',
    // Sigle societarie e rimasugli cleaning
    'srl', 'spa', 'snc', 'sas', 'srls', 'ss', 'coop', 'piazza', 'via', 'corso', 'viale', 'vicolo', 'largo', 'scrl', 'bv', 'company', 'group', 'gruppo', 'soc', 'società', 'italia', 'italy', 'it', 'europe', 'eu', 'ltd', 'inc', 'corp', 'limited', 'spa', 'spa', 'srl',
    // Città e Località (Principali italiane e generiche)
    'roma', 'milano', 'napoli', 'torino', 'palermo', 'genova', 'bologna', 'firenze', 'bari', 'catania', 'venezia', 'verona', 'messina', 'padova', 'trieste', 'brescia', 'parma', 'taranto', 'prato', 'modena', 'reggio', 'reggio emilia', 'reggio calabria', 'perugia', 'ravenna', 'livorno', 'cagliari', 'foggia', 'rimini', 'salerno', 'ferrara', 'sassari', 'latina', 'monza', 'siracusa', 'pescara', 'bergamo', 'forli', 'trento', 'vicenza', 'terni', 'bolzano', 'novara', 'piacenza', 'ancona', 'andria', 'arezzo', 'udine', 'cesena', 'lecce', 'lecco', 'lodi', 'pavia', 'cremona', 'como', 'fiumicino', 'malpensa', 'linate', 'airport', 'stazione', 'centro', 'city', 'town', 'borgo',
    // Nomi comuni che appaiono negli esercenti (Noise)
    'giovanni', 'mario', 'giuseppe', 'francesco', 'antonio', 'luca', 'marco', 'paolo', 'alessandro', 'andrea', 'roberto', 'stefano', 'angelo', 'chiara', 'giulia', 'francesca', 'federica', 'silvia', 'anna', 'maria', 'enrico', 'dario', 'claudio', 'gianni', 'sergio', 'paola', 'laura', 'elena', 'sara', 'vanna', 'beppe', 'mimmo',
    // Termini troppo generici che già abbiamo in Stage 3
    'bar', 'cafe', 'ristorante', 'pizzerie', 'pizzeria', 'market', 'supermercato', 'negozio', 'shop', 'store', 'online', 'util', 'utilizzo', 'pagamento', 'pos', 'transazione', 'bollettino', 'bonifico', 'commissione', 'prelievo', 'atm', 'carta', 'maestro', 'visa', 'mastercard', 'esercente', 'favore', 'addebito'
  ];
  
  return clean.split(' ')
    .filter(word => word.length > 2 && !stopWords.includes(word.toLowerCase()) && isNaN(word));
}

/**
 * 📦 CATEGORIZZAZIONE BATCH PER PERFORMANCE
 */
async function categorizeBatchUltimate(transactions, userId) {
  const summarized = [];
  for (const tx of transactions) {
     const res = await categorizeUltimate(tx, userId);
     summarized.push({
       ...tx,
       category: res.category,
       confidence: res.confidence,
       categorizationReason: res.reason
     });
  }
  return summarized;
}

const { CATEGORY_METADATA } = require('./categoryMetadata');

const DEFAULT_CATEGORIES = {};
for (const [name, meta] of Object.entries(CATEGORY_METADATA)) {
  DEFAULT_CATEGORIES[name] = {
    emoji: meta.emoji,
    color: meta.color,
    patterns: CATEGORIES_MAP[name] || []
  };
}

module.exports = {
  intelligentNoiseRemoval,
  categorizeUltimate,
  categorizeBatchUltimate,
  extractKeywords,
  DEFAULT_CATEGORIES,
  CATEGORIES: Object.keys(CATEGORY_METADATA)
};
