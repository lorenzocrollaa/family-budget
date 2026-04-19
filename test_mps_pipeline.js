const { parseBankPDF } = require('./utils/parsers/index');
const pdfParse = require('pdf-parse');
const fs = require('fs');

async function testProductionFlow() {
    const buffer = fs.readFileSync('test_files/Estratto conto Monte dei Paschi.pdf');
    
    // Simulo l'estrazione strutturata di fileParser.js
    const options = {
        pagerender: (pageData) => {
            return pageData.getTextContent().then(textContent => {
                let lastY, text = '';
                const items = textContent.items.sort((a, b) => {
                    const dy = b.transform[5] - a.transform[5];
                    if (Math.abs(dy) < 1.0) return a.transform[4] - b.transform[4];
                    return dy;
                });
                for (let item of items) {
                    const currentY = item.transform[5];
                    const currentX = Math.round(item.transform[4]);
                    if (lastY !== undefined && Math.abs(currentY - lastY) < 1.0) {
                        text += ' ' + `[${currentX}]` + item.str;
                    } else {
                        if (text !== '') text += '\n';
                        text += `[${currentX}]` + item.str;
                    }
                    lastY = currentY;
                }
                return text;
            });
        }
    };

    console.log('🧪 Estrazione testuale strutturata...');
    const data = await pdfParse(buffer, options);
    const text = data.text;
    
    console.log('🧪 Chiamata a parseBankPDF...');
    const result = parseBankPDF(text);
    
    if (result.success) {
        console.log('✅ SUCCESS! Trovate ' + result.transactions.length + ' transazioni.');
        
        let entrate = 0, uscite = 0;
        result.transactions.forEach(t => {
            if (t.amount > 0) entrate += t.amount;
            else uscite += t.amount;
        });
        
        console.log(`Calculated Uscite: ${uscite.toFixed(2)} (Target: -10057.87)`);
        console.log(`Calculated Entrate: ${entrate.toFixed(2)} (Target: 9443.69)`);

    } else {
        console.log('❌ FAILED: ' + result.error);
        // Stampiamo le prime 100 righe per vedere cosa non va
        console.log('--- SAMPLE TEXT (first 100 lines) ---');
        console.log(text.split('\n').slice(0, 100).join('\n'));
    }
}

testProductionFlow();
