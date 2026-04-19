
const { parseFile } = require('./utils/fileParser');
const path = require('path');

const filePath = '/Users/lorenzo.crolla/family-budget-banking/test_files/ListaTransazioni.pdf';

async function test() {
    console.log('--- TESTING BUDDYBANK PARSING ---');
    try {
        const result = await parseFile(filePath, 'ListaTransazioni.pdf', 'application/pdf');
        
        if (result.success) {
            console.log('✅ SUCCESS!');
            console.log('Bank Format:', result.bankFormat);
            console.log('Transactions Found:', result.transactions.length);
            console.log('--- FIRST 5 TRANSACTIONS ---');
            console.log(JSON.stringify(result.transactions.slice(0, 5), null, 2));
            console.log('--- DATE RANGE ---');
            console.log(result.dateRange);
        } else {
            console.log('❌ FAILED:', result.error);
            console.log('Details:', result.details);
        }
    } catch (e) {
        console.error('CRITICAL ERROR:', e);
    }
}

test();
