const MpsParser = require('./utils/parsers/mpsParser');

const parser = new MpsParser();

const testStrings = [
    "A Volkswagen Bank Gmbh Codice Mandato Itco000002572490m001 Importo 296,84 Commissioni 0,00 Spese 0,00 Payment Loan N. 2572490 Installment N. 19 DEL 01 10 2025",
    "ADDEBITO DIRETTO N. 601139555 A FAVORE VOLKSWAGEN BANK GMBH CODICE MANDATO ITCO000002572490M001 IMPORTO 296,84 COMMISSIONI 0,00 SPESE 0,00 payment loan n. 2572490 installment n. 21 del 01 /12/2025"
];

console.log("=== ENHANCED CLEANING TEST ===");

testStrings.forEach(s => {
    // Simulo una transazione parsata
    const tx = {
        dateStr: "01/01/26",
        description: s,
        amount: 296.84,
        isIncome: false
    };
    
    // Devo simulare la lista per pushParsedTransaction
    const list = [];
    parser.pushParsedTransaction(list, tx);
    
    if (list.length > 0) {
        console.log(`\nORIGINAL: ${s}`);
        console.log(`CLEANED:  ${list[0].description}`);
    } else {
        console.log(`\nFAILED TO PUSH: ${s}`);
    }
});
