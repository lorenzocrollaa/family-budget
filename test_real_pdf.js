
const fs = require('fs');
const pdfParse = require('pdf-parse');

async function test() {
    const dir = './uploads/statements';
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.pdf'));
    files.sort((a, b) => fs.statSync(dir + '/' + b).mtime.getTime() - fs.statSync(dir + '/' + a).mtime.getTime());
    
    for (const file of files.slice(0, 3)) {
        try {
            const dataBuffer = fs.readFileSync(dir + '/' + file);
            const data = await pdfParse(dataBuffer);
            const lines = data.text.split('\n');
            let found = false;
            
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes('Giulia Maria Tullia') || lines[i].includes('RICCARDO CROLLA')) {
                    console.log(`\nFound target at ${file} line ${i}`);
                    for(let j = -2; j <= 6; j++) {
                        if (lines[i+j] !== undefined) console.log(`[L-${i+j}] ` + lines[i+j]);
                    }
                    found = true;
                }
            }
            if (found) break;
        } catch (e) {}
    }
}
test();
