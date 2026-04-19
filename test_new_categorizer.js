const { categorizeUltimate } = require('./utils/ultimateCategorizer');
require('dotenv').config();

async function test() {
  const transactions = [
    { description: 'MARINARI MILANO', amount: -25.50 }, // Should trigger Google Places if not in local map
    { description: 'PASTICCERIA MARINARI', amount: -15.00 },
    { description: 'IL BARBARO SNC', amount: -20 }, 
    { description: 'CALZEDONIA0123', amount: -30 }
  ];

  console.log("--- TESTING ULTIMATE CATEGORIZER WITH GOOGLE PLACES FALLBACK ---");
  for (const t of transactions) {
     try {
       const res = await categorizeUltimate(t, 'clm1lvp6l000008l21dca9jxh'); // Use a dummy or real userId
       console.log(`Desc: "${t.description}"\n --> Category: [${res.category}] (Reason: ${res.reason})\n`);
     } catch (err) {
       console.error(`Error testing "${t.description}":`, err.message);
     }
  }
}

test().catch(console.error);
