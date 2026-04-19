// test-categorization.js - Script per verificare la nuova logica di categorizzazione

const { superCleanDescription, categorizeSingle } = require('./utils/categorizer');

async function runTests() {
  const testCases = [
    { desc: 'LIDL 048 MILANO IT', amount: -25.50, expected: 'Alimentari' },
    { desc: 'AMZN MKTP IT 31/12', amount: -42.00, expected: 'Acquisti Online' },
    { desc: 'BONIFICO SEPA PRO TV SAMSUNG', amount: -650.00, expected: 'Bonifici' },
    { desc: 'STIPENDIO MARZO 2024', amount: 2500.00, expected: 'Stipendio' },
    { desc: 'ENEL ENERGIA SPA RIF. 123456', amount: -85.00, expected: 'Bollette' },
    { desc: 'MCDONALD S 00123 ROME', amount: -15.20, expected: 'Ristoranti' },
    { desc: 'TRN 1234567890 BNL PRELIEVO ATM', amount: -50.00, expected: 'Bonifici' }, // Prelievo va in Bonifici (ATM)
    { desc: 'A COGNOME NOME BONIFICO A VOSTRO FAVORE', amount: 150.00, expected: 'Entrate Varie' }
  ];

  console.log('🚀 Inizio test di categorizzazione...\n');

  for (const tc of testCases) {
    const clean = superCleanDescription(tc.desc);
    const result = await categorizeSingle(tc.desc, tc.amount);
    
    const status = result.category === tc.expected ? '✅' : '❌';
    console.log(`${status} Desc: "${tc.desc}"`);
    console.log(`   Cleaned: "${clean}"`);
    console.log(`   Result:  ${result.category} (Conf: ${result.confidence.toFixed(2)}, Method: ${result.method})\n`);
  }

  console.log('🏁 Test terminati.');
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Errore durante i test:', err);
  process.exit(1);
});
