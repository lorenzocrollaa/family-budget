// test-google-places.js - Script per testare Google Places API
// Uso: node test-google-places.js

require('dotenv').config();
const axios = require('axios');

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const ENABLED = process.env.GOOGLE_PLACES_ENABLED === 'true';

console.log('🧪 Test Google Places API Configuration\n');

// Check 1: API Key presente?
if (!API_KEY) {
  console.error('❌ GOOGLE_PLACES_API_KEY non trovata nel .env');
  console.log('   Aggiungi: GOOGLE_PLACES_API_KEY=tua_chiave_qui');
  process.exit(1);
}

console.log('✅ API Key trovata:', API_KEY.substring(0, 20) + '...');

// Check 2: API Enabled?
if (!ENABLED) {
  console.log('⚠️  GOOGLE_PLACES_ENABLED=false nel .env');
  console.log('   Il sistema funzionerà solo con AI locale');
  process.exit(0);
}

console.log('✅ API abilitata\n');

// Check 3: Test chiamata API
console.log('🌍 Test chiamata API...');

async function testAPI() {
  try {
    const response = await axios.post(
      'https://places.googleapis.com/v1/places:searchText',
      {
        textQuery: 'Colosseum Rome',
        maxResultCount: 1
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': API_KEY,
          'X-Goog-FieldMask': 'places.displayName,places.types,places.primaryType'
        },
        timeout: 5000
      }
    );

    if (response.data.places && response.data.places.length > 0) {
      const place = response.data.places[0];
      console.log('\n✅ API FUNZIONA PERFETTAMENTE!\n');
      console.log('📍 Test Query: "Colosseum Rome"');
      console.log('📍 Trovato:', place.displayName.text);
      console.log('📍 Tipo:', place.primaryType);
      console.log('📍 Tipi:', place.types.join(', '));
      console.log('\n💰 Costo test: $0.032 (1 chiamata)');
      console.log('✨ Tutto configurato correttamente!\n');
      return true;
    }
    
    console.log('⚠️  API risponde ma nessun risultato');
    return false;
    
  } catch (error) {
    console.error('\n❌ ERRORE API:\n');
    
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Messaggio:', error.response.data?.error?.message || 'Unknown error');
      
      if (error.response.status === 400) {
        console.log('\n💡 Possibili cause:');
        console.log('   - API Key non valida');
        console.log('   - Places API (New) non abilitata');
        console.log('   - Restrizioni API key troppo rigide');
      }
      
      if (error.response.status === 403) {
        console.log('\n💡 Possibili cause:');
        console.log('   - Places API (New) non abilitata nel progetto');
        console.log('   - Billing non configurato');
        console.log('   - API key con restrizioni IP/referrer sbagliate');
      }
      
      if (error.response.status === 429) {
        console.log('\n💡 Quota esaurita!');
        console.log('   - Troppi test fatti oggi');
        console.log('   - Riprova domani o aumenta quota');
      }
    } else if (error.code === 'ECONNABORTED') {
      console.error('⏱️  Timeout - Google API non raggiungibile');
    } else {
      console.error('Errore:', error.message);
    }
    
    console.log('\n📚 Controlla la guida:');
    console.log('   1. Vai su https://console.cloud.google.com');
    console.log('   2. Verifica che "Places API (New)" sia ENABLED');
    console.log('   3. Verifica che Billing sia configurato');
    console.log('   4. Controlla le restrizioni della API key\n');
    
    return false;
  }
}

testAPI();