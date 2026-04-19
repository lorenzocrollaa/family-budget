const { categorizeUltimate } = require('./utils/ultimateCategorizer');

async function test() {
    const userId = "test-user-id";
    const testCases = [
        // Ristoranti
        { description: 'RISTORANTE IL POSTO', amount: -45.0, expected: 'Ristoranti' },
        { description: 'PIZZERIA DA MARIO', amount: -22.0, expected: 'Ristoranti' },
        { description: 'BAR CENTRALE', amount: -5.0, expected: 'Ristoranti' },
        { description: 'SUSHI WOK', amount: -35.0, expected: 'Ristoranti' },
        
        // Alimentari
        { description: 'ESSELUNGA ROMA', amount: -65.0, expected: 'Alimentari' },
        { description: 'CONAD CITY', amount: -15.0, expected: 'Alimentari' },
        { description: 'MACELLERIA GIANNI', amount: -20.0, expected: 'Alimentari' },
        { description: 'PANIFICIO BELLO', amount: -4.0, expected: 'Alimentari' },
        
        // Salute
        { description: 'FARMACIA COMUNALE', amount: -12.0, expected: 'Salute' },
        { description: 'DENTISTA DARIO', amount: -150.0, expected: 'Salute' },
        { description: 'ANALISI CLINICHE', amount: -40.0, expected: 'Salute' },
        { description: 'DIAGNOSTICA BASH', amount: -80.0, expected: 'Salute' },
        
        // Tecnologia e Casa
        { description: 'MEDIAWORLD ROMA', amount: -299.0, expected: 'Tecnologia' }, // Apple/Amazon are Tech
        { description: 'IKEA PORTA DI ROMA', amount: -120.0, expected: 'Casa' },
        { description: 'LEROY MERLIN', amount: -50.0, expected: 'Casa' },
        
        // Paghetta
        { description: 'PAGHETTA BAMBINI', amount: -50.0, expected: 'Paghetta' },
        
        // Prelievi
        { description: 'PRELIEVO BANCOMAT', amount: -100.0, expected: 'Prelievi' },
        { description: 'ATM UNICREDIT', amount: -50.0, expected: 'Prelievi' },

        // Commissioni
        { description: 'CANONE CONTO', amount: -5.0, expected: 'Commissioni Bancarie' },
        { description: 'BOLLO ESTRATTO CONTO', amount: -2.0, expected: 'Commissioni Bancarie' }
    ];

    console.log('--- Testing General Categorization Network ---');
    for (const tc of testCases) {
        const result = await categorizeUltimate(tc, userId);
        const icon = result.category === tc.expected ? '✅' : '❌';
        console.log(`${icon} Description: "${tc.description}" -> Category: ${result.category} (Expected: ${tc.expected}) [Reason: ${result.reason}]`);
    }
}

test();
