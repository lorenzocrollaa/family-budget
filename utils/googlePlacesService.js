// utils/googlePlacesService.js - Google Places API Integration

const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Configurazione
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const GOOGLE_PLACES_ENABLED = process.env.GOOGLE_PLACES_ENABLED === 'true';
const CACHE_DAYS = parseInt(process.env.GOOGLE_PLACES_CACHE_DAYS || '365');

// Statistiche (per monitoring)
let stats = {
  apiCalls: 0,
  cacheHits: 0,
  cacheMisses: 0,
  errors: 0,
  lastReset: new Date()
};

/**
 * Estrae nome pulito del merchant dalla descrizione
 */
function extractMerchantName(description) {
  let cleaned = description.toLowerCase().trim();
  
  // Rimuovi pattern comuni bancari
  cleaned = cleaned
    .replace(/\b(pagamento|apple pay|mastercard|visa|carta|pos|nfc|bonifico)\b/gi, '')
    .replace(/\b(addebito|accredito|operazione|transazione)\b/gi, '')
    .replace(/\b(s\.?r\.?l\.?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?)\b/gi, '') 
    .replace(/\bcommissione.*$/gi, '')
    .replace(/\bdel\s+\d{2}\/\d{2}\/\d{4}/g, '')
    .replace(/\bcarta\s*\*?\d+/gi, '')
    .replace(/\d{2}\/\d{2}\/\d{4}/g, '')
    .replace(/[EUR$]\s*[\d,.]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  // Prendi prime 3-5 parole significative
  const words = cleaned.split(' ').filter(w => w.length > 2);
  const merchantName = words.slice(0, Math.min(5, words.length)).join(' ');
  
  return merchantName;
}

/**
 * 🗺️ MAPPA DEFINITIVA GOOGLE PLACES (ESTESA A TUTTI I TIPI)
 * Mappa oltre 230 tipi ufficiali di Google Places alle categorie dell'app.
 */
function mapGoogleTypeToCategory(googleType) {
  if (!googleType) return 'Altre Spese';

  const typeMap = {
    // 🥘 RISTORANTI & FOOD CRAFT
    'bakery': 'Ristoranti', 'pastry_shop': 'Ristoranti', 'cafe': 'Ristoranti', 'coffee_shop': 'Ristoranti',
    'confectionery': 'Ristoranti', 'dessert_shop': 'Ristoranti', 'donut_shop': 'Ristoranti', 'ice_cream_shop': 'Ristoranti',
    'juice_shop': 'Ristoranti', 'tea_house': 'Ristoranti', 'candy_store': 'Ristoranti', 'chocolate_shop': 'Ristoranti',
    'cake_shop': 'Ristoranti', 'acai_shop': 'Ristoranti', 'bagel_shop': 'Ristoranti', 'deli': 'Ristoranti',
    'wine_bar': 'Ristoranti', 'winery': 'Ristoranti', 'brewery': 'Ristoranti', 'brewpub': 'Ristoranti',
    'bar': 'Ristoranti', 'pub': 'Ristoranti', 'irish_pub': 'Ristoranti', 'cocktail_bar': 'Ristoranti',
    'lounge_bar': 'Ristoranti', 'bar_and_grill': 'Ristoranti', 'night_club': 'Ristoranti',
    'restaurant': 'Ristoranti', 'bistro': 'Ristoranti', 'brunch_restaurant': 'Ristoranti', 'breakfast_restaurant': 'Ristoranti',
    'fast_food_restaurant': 'Ristoranti', 'food_court': 'Ristoranti', 'cafeteria': 'Ristoranti', 'canteen': 'Ristoranti',
    'steak_house': 'Ristoranti', 'sushi_restaurant': 'Ristoranti', 'pizza_restaurant': 'Ristoranti', 'burger_restaurant': 'Ristoranti',
    'seafood_restaurant': 'Ristoranti', 'vegetarian_restaurant': 'Ristoranti', 'vegan_restaurant': 'Ristoranti',
    'american_restaurant': 'Ristoranti', 'italian_restaurant': 'Ristoranti', 'french_restaurant': 'Ristoranti',
    'japanese_restaurant': 'Ristoranti', 'chinese_restaurant': 'Ristoranti', 'mexican_restaurant': 'Ristoranti',
    'indian_restaurant': 'Ristoranti', 'thai_restaurant': 'Ristoranti', 'mediterranean_restaurant': 'Ristoranti',
    'middle_eastern_restaurant': 'Ristoranti', 'greek_restaurant': 'Ristoranti', 'spanish_restaurant': 'Ristoranti',
    'turkish_restaurant': 'Ristoranti', 'korean_restaurant': 'Ristoranti', 'vietnamese_restaurant': 'Ristoranti',
    'brazilian_restaurant': 'Ristoranti', 'lebanese_restaurant': 'Ristoranti', 'caribbean_restaurant': 'Ristoranti',
    'african_restaurant': 'Ristoranti', 'asian_restaurant': 'Ristoranti', 'european_restaurant': 'Ristoranti',
    'australian_restaurant': 'Ristoranti', 'austrian_restaurant': 'Ristoranti', 'belgian_restaurant': 'Ristoranti',
    'british_restaurant': 'Ristoranti', 'canadian_restaurant': 'Ristoranti', 'carribean_restaurant': 'Ristoranti',
    'czech_restaurant': 'Ristoranti', 'danish_restaurant': 'Ristoranti', 'dutch_restaurant': 'Ristoranti',
    'ethiopian_restaurant': 'Ristoranti', 'german_restaurant': 'Ristoranti', 'hungarian_restaurant': 'Ristoranti',
    'indonesian_restaurant': 'Ristoranti', 'irish_restaurant': 'Ristoranti', 'israeli_restaurant': 'Ristoranti',
    'malaysian_restaurant': 'Ristoranti', 'moroccan_restaurant': 'Ristoranti', 'peruvian_restaurant': 'Ristoranti',
    'polish_restaurant': 'Ristoranti', 'portuguese_restaurant': 'Ristoranti', 'romanian_restaurant': 'Ristoranti',
    'russian_restaurant': 'Ristoranti', 'scandinavian_restaurant': 'Ristoranti', 'swiss_restaurant': 'Ristoranti',
    'taiwanese_restaurant': 'Ristoranti', 'ukrainian_restaurant': 'Ristoranti',

    // 🛒 ALIMENTARI
    'grocery_store': 'Alimentari', 'supermarket': 'Alimentari', 'convenience_store': 'Alimentari',
    'meat_market': 'Alimentari', 'produce_market': 'Alimentari', 'seafood_market': 'Alimentari',
    'fruit_and_vegetable_store': 'Alimentari', 'liquor_store': 'Alimentari', 'market': 'Alimentari',
    'wholesaler': 'Alimentari', 'warehouse_club': 'Alimentari', 'butcher_shop': 'Alimentari',
    'delicatessen': 'Alimentari', 'organic_store': 'Alimentari', 'food_market': 'Alimentari',

    // 🚗 TRASPORTI
    'gas_station': 'Trasporti', 'electric_vehicle_charging_station': 'Trasporti', 'ebike_charging_station': 'Trasporti',
    'parking': 'Trasporti', 'parking_garage': 'Trasporti', 'parking_lot': 'Trasporti',
    'car_rental': 'Trasporti', 'car_repair': 'Trasporti', 'car_wash': 'Trasporti', 'tire_shop': 'Trasporti',
    'car_dealer': 'Trasporti', 'truck_dealer': 'Trasporti', 'bus_station': 'Trasporti', 'bus_stop': 'Trasporti',
    'train_station': 'Trasporti', 'transit_station': 'Trasporti', 'subway_station': 'Trasporti', 'taxi_stand': 'Trasporti',
    'airport': 'Trasporti', 'ferry_terminal': 'Trasporti', 'heliport': 'Trasporti', 'light_rail_station': 'Trasporti',

    // 🛍️ SHOPPING
    'clothing_store': 'Shopping', 'shoe_store': 'Shopping', 'jewelry_store': 'Shopping', 'electronics_store': 'Shopping',
    'department_store': 'Shopping', 'shopping_mall': 'Shopping', 'gift_shop': 'Shopping', 'toy_store': 'Shopping',
    'book_store': 'Shopping', 'pet_store': 'Shopping', 'florist': 'Shopping', 'bicycle_store': 'Shopping',
    'leather_goods_store': 'Shopping', 'luggage_store': 'Shopping', 'souvenir_shop': 'Shopping',
    'stationery_store': 'Shopping', 'duty_free_store': 'Shopping', 'store': 'Shopping', 'establishment': 'Shopping',

    // 🏥 SALUTE
    'pharmacy': 'Salute', 'drugstore': 'Salute', 'hospital': 'Salute', 'medical_clinic': 'Salute',
    'dentist': 'Salute', 'doctor': 'Salute', 'medical_center': 'Salute', 'medical_lab': 'Salute',
    'physiotherapist': 'Salute', 'chiropractor': 'Salute', 'dental_clinic': 'Salute', 'general_hospital': 'Salute',
    'optician': 'Salute', 'optical_goods_store': 'Salute',

    // 💆 BENESSERE
    'beauty_salon': 'Benessere', 'hair_salon': 'Benessere', 'hair_care': 'Benessere', 'spa': 'Benessere',
    'massage': 'Benessere', 'massage_spa': 'Benessere', 'barber_shop': 'Benessere', 'nail_salon': 'Benessere',
    'sauna': 'Benessere', 'skin_care_clinic': 'Benessere', 'tanning_studio': 'Benessere', 'wellness_center': 'Benessere',
    'yoga_studio': 'Benessere',

    // ⚽ SPORT
    'gym': 'Sport', 'fitness_center': 'Sport', 'sports_club': 'Sport', 'sports_complex': 'Sport',
    'stadium': 'Sport', 'swimming_pool': 'Sport', 'golf_course': 'Sport', 'tennis_court': 'Sport',
    'adventure_sports_center': 'Sport', 'athletic_field': 'Sport', 'ski_resort': 'Sport',

    // 🏠 CASA & SERVIZI
    'hardware_store': 'Casa', 'home_improvement_store': 'Casa', 'furniture_store': 'Casa', 'home_goods_store': 'Casa',
    'garden_center': 'Casa', 'electrician': 'Casa', 'plumber': 'Casa', 'painter': 'Casa',
    'moving_company': 'Casa', 'locksmith': 'Casa', 'roofing_contractor': 'Casa', 'pest_control_service': 'Casa',
    'interior_designer': 'Casa', 'general_contractor': 'Casa', 'landscaper': 'Casa',

    // 🎬 INTRATTENIMENTO & SVAGO
    'movie_theater': 'Intrattenimento', 'cinema': 'Intrattenimento', 'museum': 'Intrattenimento', 'art_gallery': 'Intrattenimento',
    'art_museum': 'Intrattenimento', 'casino': 'Intrattenimento', 'bowling_alley': 'Intrattenimento', 'amusement_park': 'Intrattenimento',
    'aquarium': 'Intrattenimento', 'zoo': 'Intrattenimento', 'performing_arts_theater': 'Intrattenimento', 'tourist_attraction': 'Intrattenimento',
    'comedy_club': 'Intrattenimento', 'concert_hall': 'Intrattenimento', 'opera_house': 'Intrattenimento', 'planetarium': 'Intrattenimento',
    'video_arcade': 'Intrattenimento', 'water_park': 'Intrattenimento', 'wildlife_park': 'Intrattenimento', 'historical_landmark': 'Intrattenimento',
    'park': 'Intrattenimento', 'city_park': 'Intrattenimento', 'national_park': 'Intrattenimento',

    // ✈️ VIAGGI
    'hotel': 'Viaggi', 'motel': 'Viaggi', 'resort_hotel': 'Viaggi', 'bed_and_breakfast': 'Viaggi',
    'hostel': 'Viaggi', 'guest_house': 'Viaggi', 'campground': 'Viaggi', 'vacation_rental': 'Viaggi',
    'travel_agency': 'Viaggi', 'lodging': 'Viaggi',

    // 🏦 BANCA & PRELIEVI
    'bank': 'Prelievi', 'atm': 'Prelievi', 'finance': 'Commissioni Bancarie', 'accounting': 'Commissioni Bancarie',
    'insurance_agency': 'Commissioni Bancarie',

    // 📄 SERVIZI PUBBLICI / BOLLETTE
    'post_office': 'Bollette', 'courier_service': 'Bollette', 'utility_company': 'Bollette', 'telecommunications_service_provider': 'Bollette',
    'local_government_office': 'Bollette', 'police': 'Bollette', 'fire_station': 'Bollette', 'city_hall': 'Bollette',
    'courthouse': 'Bollette', 'embassy': 'Bollette',

    // 🎓 EDUCAZIONE
    'school': 'Educazione', 'university': 'Educazione', 'library': 'Educazione', 'preschool': 'Educazione',
    'primary_school': 'Educazione', 'secondary_school': 'Educazione', 'research_institute': 'Educazione'
  };

  const category = typeMap[googleType];
  
  if (category) {
    return category;
  }
  
  for (const [type, cat] of Object.entries(typeMap)) {
    if (googleType.toLowerCase().includes(type.toLowerCase())) {
      return cat;
    }
  }
  
  if (googleType === 'point_of_interest' || googleType === 'establishment') {
    return 'Shopping';
  }
  
  console.log('⚠️ [Google Service] Unknown Google type: ' + googleType + ', using Altre Spese');
  return 'Altre Spese';
}

async function searchCache(merchantName, userId) {
  try {
    const cacheExpiry = new Date(Date.now() - CACHE_DAYS * 24 * 60 * 60 * 1000);
    
    const cached = await prisma.merchantCache.findFirst({
      where: {
        OR: [
          { merchantName: merchantName },
          { merchantName: { contains: merchantName } }
        ],
        createdAt: { gte: cacheExpiry }
      },
      orderBy: { confidence: 'desc' }
    });
    
    if (cached) {
      stats.cacheHits++;
      console.log(`🧠 [Google Service] Cache Hit: "${merchantName}" -> ${cached.category} (da cache globale)`);
      return {
        found: true,
        category: cached.category,
        confidence: cached.confidence,
        source: 'cache',
        googleType: cached.googleType,
        location: cached.location
      };
    }
    
    stats.cacheMisses++;
    return { found: false };
    
  } catch (error) {
    console.error('Cache search error:', error.message);
    return { found: false };
  }
}

async function searchGooglePlaces(merchantName, location = null) {
  if (!GOOGLE_PLACES_ENABLED || !GOOGLE_PLACES_API_KEY) {
    console.log('Google Places API disabled or no API key');
    return { found: false, reason: 'api_disabled' };
  }
  
  try {
    stats.apiCalls++;
    
    const searchQuery = location ? merchantName + ' ' + location : merchantName;
    const url = 'https://places.googleapis.com/v1/places:searchText';
    
    console.log('Google Places lookup: ' + searchQuery);
    
    const response = await axios.post(
      url,
      {
        textQuery: searchQuery,
        maxResultCount: 1,
        languageCode: 'it'
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
          'X-Goog-FieldMask': 'places.displayName,places.types,places.primaryType,places.formattedAddress'
        },
        timeout: 5000
      }
    );
    
    if (!response.data.places || response.data.places.length === 0) {
      console.log(`❌ [Google Service] Nessun risultato da Google per: "${merchantName}"`);
      return { found: false, reason: 'no_results' };
    }
    
    const place = response.data.places[0];
    const category = mapGoogleTypeToCategory(place.primaryType || place.types[0]);
    
    console.log(`✅ [Google Service] Trovato: "${place.displayName.text}" | Tipo Google: ${place.primaryType || place.types[0]} -> Mappato a: ${category}`);
    
    return {
      found: true,
      name: place.displayName.text,
      category: category,
      googleType: place.primaryType || place.types[0],
      types: place.types,
      location: place.formattedAddress,
      confidence: 0.95,
      source: 'google_places'
    };
    
  } catch (error) {
    stats.errors++;
    console.error('Google Places API error:', error.response?.data?.error?.message || error.message);
    
    if (error.response?.status === 429) {
      console.error('Google Places quota exceeded!');
    }
    
    return { found: false, reason: 'api_error', error: error.message };
  }
}

async function saveToCache(merchantName, result, userId = null) {
  try {
    await prisma.merchantCache.create({
      data: {
        merchantName: merchantName.toLowerCase(),
        category: result.category,
        googleType: result.googleType || null,
        location: result.location || null,
        confidence: result.confidence,
        source: result.source,
        userId: userId
      }
    });
    
    console.log('Saved to cache: ' + merchantName + ' -> ' + result.category);
    
  } catch (error) {
    if (!error.message.includes('Unique constraint')) {
      console.error('Cache save error:', error.message);
    }
  }
}

async function lookupMerchant(description, location = null, userId = null) {
  const merchantName = extractMerchantName(description);
  
  if (!merchantName || merchantName.length < 3) {
    return { found: false, reason: 'invalid_merchant_name' };
  }
  
  console.log('\nMerchant lookup: ' + merchantName);
  
  const cached = await searchCache(merchantName, userId);
  
  if (cached.found) {
    return cached;
  }
  
  const googleResult = await searchGooglePlaces(merchantName, location);
  
  if (googleResult.found) {
    await saveToCache(merchantName, googleResult, userId);
    return googleResult;
  }
  
  return { found: false, reason: 'not_found' };
}

function getStats() {
  return {
    ...stats,
    cacheHitRate: stats.cacheHits + stats.cacheMisses > 0 
      ? ((stats.cacheHits / (stats.cacheHits + stats.cacheMisses)) * 100).toFixed(1) + '%'
      : 'N/A',
    uptime: Math.floor((Date.now() - stats.lastReset) / 1000 / 60) + ' minutes'
  };
}

function resetStats() {
  stats = {
    apiCalls: 0,
    cacheHits: 0,
    cacheMisses: 0,
    errors: 0,
    lastReset: new Date()
  };
}

module.exports = {
  lookupMerchant,
  getStats,
  resetStats,
  extractMerchantName
};
