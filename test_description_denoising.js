const BaseBankParser = require('./utils/parsers/baseBankParser');
const parser = new BaseBankParser();

const testCases = [
  { input: 'Bonifico 048 Semenzin Matteo 2025-12-25', expected: 'Bonifico Semenzin Matteo' },
  { input: 'PAGAMENTO POS 123456789 STORE', expected: 'PAGAMENTO POS STORE' },
  { input: 'A2A Energia Bolletta 15:30', expected: 'A2A Energia Bolletta' },
  { input: 'iPhone 15 Store London', expected: 'iPhone 15 Store London' },
  { input: 'TRN:1234567890 ABCD RIF:9999', expected: 'ABCD' },
  { input: 'Prelievo ATM 10.05.2025 Via Roma 123', expected: 'Prelievo ATM Via Roma' },
  { input: 'H3G Ricarica 5G', expected: 'H3G Ricarica 5G' }
];

console.log("🧪 Starting Description De-noising Verification...");

let allPassed = true;
testCases.forEach(tc => {
    const result = parser.cleanDescription(tc.input);
    if (result === tc.expected) {
        console.log(`  ✅ PASSED: "${tc.input}" -> "${result}"`);
    } else {
        console.error(`  ❌ FAILED: "${tc.input}"`);
        console.error(`     Expected:  "${tc.expected}"`);
        console.error(`     Got:       "${result}"`);
        
        // Let's trace it
        let step = tc.input;
        console.log(`     Trace:`);
        step = step.replace(/(?:\d{1,2}|\d{4})[\-\/.]\d{1,2}[\-\/.](?:\d{2,4})\b/g, '[DATE]');
        console.log(`       1. Date: ${step}`);
        step = step.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, '[TIME]');
        console.log(`       2. Time: ${step}`);
        step = step.replace(/\b\d{3,}\b/g, '[NUM3+]');
        console.log(`       3. Num3+: ${step}`);
        step = step.replace(/\b(?:TRN|RIF|ID|CODE|N)[:\-\.]?\s*[A-Z0-9\-]+\b/gi, '[TECH]');
        console.log(`       4. Tech: ${step}`);
        step = step.replace(/[^\w\sàèéìòùÀÈÉÌÒÙ€.,\-*]/gi, ' ');
        console.log(`       5. Final: ${step.replace(/\s+/g, ' ').trim()}`);

        allPassed = false;
    }
});

if (allPassed) {
    console.log("\n✨ ALL TESTS PASSED! Descriptions are now clean and professional.");
} else {
    process.exit(1);
}
