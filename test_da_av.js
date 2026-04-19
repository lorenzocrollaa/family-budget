const fileParser = require('./utils/fileParser');

async function test() {
  const data = await fileParser.parsePDF('./test_files/documento.pdf');
  const lines = data.text.split('\n');
  for (let i = 0; i < lines.length; i++) {
     if (lines[i].includes('DARE') || lines[i].includes('AVERE')) {
         console.log(`[L-${i}] ${lines[i]}`);
     }
  }
}
test();
