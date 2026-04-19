// utils/claudeCategorizer.js - Categorizzazione con Claude AI

const CLAUDE_ENABLED = process.env.CLAUDE_CATEGORIZER_ENABLED === 'true' && 
                       process.env.ANTHROPIC_API_KEY;

if (!CLAUDE_ENABLED) {
  console.log('⚠️  Claude Categorizer DISABLED - set ANTHROPIC_API_KEY in .env to enable');
}

const CATEGORIES = [
  'Alimentari',
  'Ristoranti', 
  'Trasporti',
  'Salute',
  'Bollette',
  'Shopping',
  'Casa',
  'Sport',
  'Benessere',
  'Tecnologia',
  'Intrattenimento',
  'Educazione',
  'Bonifico',
  'Stipendio',
  'Entrate Varie',
  'Altre Spese'
];

/**
 * 🤖 USA CLAUDE per categorizzare basandosi sui risultati di ricerca web
 * 
 * Invece di contare keyword stupide, Claude LEGGE e CAPISCE
 * cosa fa davvero l'azienda dai risultati Google.
 * 
 * @param {string} merchantName - Nome del merchant
 * @param {Array} searchResults - Risultati da Google Search API
 * @returns {Object} { category, confidence, reasoning }
 */
async function categorizeMerchantWithClaude(merchantName, searchResults) {
  // Check se Claude è abilitato
  if (!CLAUDE_ENABLED) {
    return { 
      found: false, 
      reason: 'claude_disabled',
      message: 'Set ANTHROPIC_API_KEY in .env to enable Claude AI categorization'
    };
  }
  
  try {
    console.log(`  🤖 Claude AI: analyzing "${merchantName}"...`);
    
    // Prepara il contesto dai risultati di ricerca
    const context = searchResults.map((result, i) => {
      return `[${i + 1}] ${result.title}\n${result.snippet || ''}`;
    }).join('\n\n');
    
    // Prompt per Claude
    const prompt = `Analizza questi risultati di ricerca per capire che tipo di attività/azienda è "${merchantName}".

RISULTATI GOOGLE:
${context}

CATEGORIE DISPONIBILI:
${CATEGORIES.join(', ')}

TASK:
1. Leggi i risultati e capisci cosa fa questa azienda
2. Scegli la categoria più appropriata dalla lista
3. Spiega brevemente perché

Rispondi SOLO con un JSON valido in questo formato (no markdown, no backticks):
{
  "category": "Nome Categoria",
  "confidence": 0.85,
  "reasoning": "Breve spiegazione"
}`;

    // Chiamata a Claude API
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY, // ⭐ API KEY!
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        messages: [
          { role: "user", content: prompt }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json();
    const responseText = data.content[0].text.trim();
    
    // Parse JSON response
    // Rimuovi eventuali markdown artifacts
    const cleanedResponse = responseText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    const result = JSON.parse(cleanedResponse);
    
    // Valida che la categoria sia nella lista
    if (!CATEGORIES.includes(result.category)) {
      console.log(`  ⚠️  Claude returned invalid category: ${result.category}`);
      return { found: false, reason: 'invalid_category' };
    }
    
    console.log(`  ✅ Claude AI: ${result.category} (${(result.confidence * 100).toFixed(0)}%)`);
    console.log(`     Reasoning: ${result.reasoning}`);
    
    return {
      found: true,
      category: result.category,
      confidence: result.confidence,
      reasoning: result.reasoning,
      source: 'claude_ai'
    };

  } catch (error) {
    console.error('  ❌ Claude AI error:', error.message);
    return { 
      found: false, 
      reason: 'claude_error', 
      error: error.message 
    };
  }
}

/**
 * 🎯 VERSIONE SEMPLIFICATA - Solo nome merchant, niente search results
 * 
 * Claude prova a capire dalla descrizione sola
 */
async function quickCategorizeMerchant(description) {
  // Check se Claude è abilitato
  if (!CLAUDE_ENABLED) {
    return { 
      found: false, 
      reason: 'claude_disabled',
      message: 'Set ANTHROPIC_API_KEY in .env to enable Claude AI categorization'
    };
  }
  
  try {
    console.log(`  🤖 Claude Quick: analyzing "${description}"...`);
    
    const prompt = `Analizza questa descrizione di transazione bancaria e categorizzala.

DESCRIZIONE: "${description}"

CATEGORIE DISPONIBILI:
${CATEGORIES.join(', ')}

REGOLE:
- "Alimentari": supermercati, grocery, spesa, market
- "Ristoranti": ristoranti, bar, pizzerie, caffè, gelaterie
- "Trasporti": benzina, diesel, carburante, taxi, treni, voli, parcheggi
- "Salute": farmacie, medicine, visite mediche, ospedali
- "Benessere": parrucchieri, barbieri, estetiste, spa, palestre
- "Shopping": negozi abbigliamento, scarpe, moda, centri commerciali, acquisti vari
- "Casa": ferramenta, mobili, arredamento, elettrodomestici
- "Tecnologia": elettronica, computer, smartphone, software
- "Bollette": luce, gas, acqua, internet, telefono

Rispondi SOLO con JSON (no markdown):
{
  "category": "Nome Categoria",
  "confidence": 0.85,
  "reasoning": "Spiegazione"
}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY, // ⭐ API KEY!
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        messages: [
          { role: "user", content: prompt }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json();
    const responseText = data.content[0].text.trim();
    
    const cleanedResponse = responseText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    const result = JSON.parse(cleanedResponse);
    
    if (!CATEGORIES.includes(result.category)) {
      return { found: false, reason: 'invalid_category' };
    }
    
    console.log(`  ✅ Claude Quick: ${result.category} (${(result.confidence * 100).toFixed(0)}%)`);
    console.log(`     ${result.reasoning}`);
    
    return {
      found: true,
      category: result.category,
      confidence: result.confidence,
      reasoning: result.reasoning,
      source: 'claude_quick'
    };

  } catch (error) {
    console.error('  ❌ Claude Quick error:', error.message);
    return { 
      found: false, 
      reason: 'claude_error', 
      error: error.message 
    };
  }
}

/**
 * ⚡ BATCH AI PROCESSING - Elabora N transazioni in un singolo prompt
 * Questo è il GAME CHANGER che abbatte i tempi da minuti a secondi.
 */
async function batchCategorizeTransactions(transactionsArray) {
  if (!CLAUDE_ENABLED) {
    return {
      success: false,
      reason: 'claude_disabled',
      message: 'Set ANTHROPIC_API_KEY in .env to enable Claude AI categorization'
    };
  }

  try {
    console.log(`\n🚀 Claude Batch Categorization: analyzing ${transactionsArray.length} transactions in ONE go...`);

    // Prepare the list of transactions for the prompt
    const txListText = transactionsArray.map(tx => 
      `ID: ${tx.id} | Descrizione: "${tx.description}" | Importo: €${tx.amount.toFixed(2)}`
    ).join('\n');

    const prompt = `Sei l'assistente bancario AI di Family Budget. Categorizza le seguenti transazioni bancarie il più accuratamente possibile.

TRANSAZIONI DA CATEGORIZZARE:
${txListText}

CATEGORIE DISPONIBILI:
${CATEGORIES.join(', ')}

REGOLE DI BASE:
- "Alimentari": supermercati, grocery, spesa, market, Esselunga, Coop, Conad
- "Ristoranti": ristoranti, bar, pizzerie, caffè, gelaterie, pub, McDonald's, Deliveroo
- "Trasporti": benzina, diesel, carburante, taxi, Uber, treni, voli, parcheggi, autostrade
- "Salute": farmacie, medicine, visite mediche, ospedali, dentista
- "Benessere": parrucchieri, barbieri, estetiste, spa, palestre
- "Shopping": negozi abbigliamento, scarpe, moda, Zara, H&M, centri commerciali
- "Casa": ferramenta, mobili, arredamento, elettrodomestici, Ikea, Leroy Merlin
- "Tecnologia": elettronica, computer, smartphone, software, Apple, Amazon (se apparente elettronica)
- "Bollette": luce, gas, acqua, internet, telefono, TIM, Vodafone, Enel
- "Acquisti Online": Amazon generico, e-commerce vari
- "Intrattenimento": Netflix, Spotify, cinema, teatri, musei
- SE IMPORTANTO È POSITIVO (Entrata): Scegli "Stipendio" (se sembra tale) oppure "Entrate Varie". Mai dare categorie di spesa (es. Ristoranti) a soldi in entrata.
- "Altre Spese": usa solo se impossibile capire cosa sia

TASK:
Analizza ogni singola transazione. Restituisci ESATTAMENTE e SOLAMENTE un Array JSON valido, senza alcun tag o testo markdown aggiuntivo, contenente un oggetto per riga.

ESEMPIO DEL FORMATO DI RISPOSTA RICHIESTO:
[
  { "id": "id_1", "category": "Alimentari", "confidence": 0.95, "reasoning": "Nome di catena supermercati nota" },
  { "id": "id_2", "category": "Ristoranti", "confidence": 0.85, "reasoning": "Parola pizzeria presente" }
]`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022", // Use the optimal model for logic
        max_tokens: 4000,
        messages: [
          { role: "user", content: prompt }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Claude API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const responseText = data.content[0].text.trim();
    
    const cleanedResponse = responseText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    const resultsArray = JSON.parse(cleanedResponse);
    
    // Valiadate and map to a dictionary by ID for easy lookup
    const resultMap = {};
    for (const res of resultsArray) {
      if (CATEGORIES.includes(res.category)) {
        resultMap[res.id] = {
          category: res.category,
          confidence: res.confidence,
          reasoning: res.reasoning,
          source: 'claude_batch'
        };
      } else {
        // Fallback for AI hallucinating a non-existent category
        resultMap[res.id] = {
          category: 'Altre Spese',
          confidence: 0.3,
          reasoning: `AI suggested invalid category: ${res.category}`,
          source: 'claude_batch_fallback'
        };
      }
    }

    console.log(`  ✅ Claude Batch Categorization complete! Processed ${Object.keys(resultMap).length} items.`);
    
    return {
      success: true,
      results: resultMap
    };

  } catch (error) {
    console.error('  ❌ Claude Batch error:', error.message);
    return { 
      success: false, 
      error: error.message 
    };
  }
}

/**
 * 👁️‍🗨️ VISUAL AI PDF PARSING - Legge il PDF come un umano (senza rompere le griglie)
 * Supportato nattivamente da Claude 3.5 Sonnet
 */
async function parsePDFWithClaude(base64Data, originalName) {
  if (!CLAUDE_ENABLED) {
    return {
      success: false,
      error: 'Claude AI non è abilitato. Inserisci ANTHROPIC_API_KEY nel file .env per usare il parser visuale infallibile.'
    };
  }

  try {
    console.log(`\n👁️‍🗨️ Claude PDF Vision: analyzing document "${originalName}"...`);

    const prompt = `Sei un esperto contabile specializzato nell'analisi di estratti conto bancari italiani (PDF). 
Il tuo unico compito è estrarre l'elenco esatto di TRASAZIONI FINANZIARIE (Addebiti e Accrediti) dal documento allegato e restituirle in formato JSON strutturato.

ISTRUZIONI CRITICHE:
1. Ignora tutto ciò che NON è una transazione (intestazioni, pubblicità, riepiloghi carte di credito, saldo iniziale, saldo finale, fogli informativi).
2. Per le USCITE (addebiti) usa il segno negativo (-). Esempio: -45.50
3. Per le ENTRATE (accrediti) usa il segno positivo (+). Esempio: 1540.00
4. La data deve essere unificata in formato internazionale YYYY-MM-DD. Se manca l'anno, deduci l'anno corrente (o l'anno dell'estratto conto se scritto altrove).
5. Unisci le descrizioni spezzate su più righe in un'unica stringa coerente, rimuovendo le andate a capo \n.

RISPOSTA RICHIESTA: 
Restituisci ESATTAMENTE e SOLAMENTE un array JSON valido, NESSUN ALTRO TESTO. Ignora tag markdown.

ESEMPIO JSON:
[
  {
    "date": "2024-05-12",
    "description": "PAGAMENTO POS SUPERMERCATO ESSELUNGA MILANO",
    "amount": -54.32
  },
  {
    "date": "2024-05-15",
    "description": "BONIFICO IN INGRESSO DA AZIENDA SPA STIPENDIO MAGGIO",
    "amount": 2500.00
  }
]`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022", // The best model for vision / pdfs
        max_tokens: 8000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: base64Data
                }
              },
              {
                type: "text",
                text: prompt
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Claude Vision API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const responseText = data.content[0].text.trim();
    
    // Clean JSON markings
    const cleanedResponse = responseText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    const transactions = JSON.parse(cleanedResponse);
    
    if (!Array.isArray(transactions) || transactions.length === 0) {
      throw new Error("L'Intelligenza Artificiale non ha trovato transazioni valide in questo PDF.");
    }

    // Add confidence scores and map
    const mappedTransactions = transactions.map(t => ({
      date: t.date,
      description: t.description,
      amount: parseFloat(t.amount),
      originalText: `Estratto da AI Visiva: ${t.description}`,
      confidence: 0.99
    }));

    console.log(`  ✅ Claude Vision ha estratto perfettamente ${mappedTransactions.length} transazioni dal PDF.`);

    return {
      success: true,
      transactions: mappedTransactions,
      method: "Claude Vision AI",
      bankFormat: "Visual AI Extraction",
      parserUsed: "claude-3-5-sonnet"
    };

  } catch (error) {
    console.error('  ❌ Claude Vision error:', error.message);
    return {
      success: false,
      error: `Claude Vision Fallito: ${error.message}`
    };
  }
}

module.exports = {
  categorizeMerchantWithClaude,
  quickCategorizeMerchant,
  batchCategorizeTransactions,
  parsePDFWithClaude,
  CATEGORIES
};