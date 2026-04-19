const BNLParser = require('./utils/parsers/bnlParser');
const bnl = new BNLParser();

const testStrings = [
  "[50]31/12/2025 [120]23/12/2025 [197]43 [217]Pag MAESTRO Carta 32616362 23.12.25 10:58 in EUR [474] 10,82 € | [217]esercente DEA CARNI [#294]",
  "[50]31/12/2025 [120]24/12/2025 [197]43 [217]Pag MAESTRO Carta 30950499 24.12.25 12:44 in EUR [474] 15,00 € | [217]esercente FERRAMENTA GALLIA DI A [#295]"
];

testStrings.forEach(s => {
  const list = [];
  const raw = s.replace(/ \[#\d+\]$/, '');
  bnl.pushBNLTransaction(list, {
    description: raw,
    amount: -10,
    xCoord: 100,
    date: '2025-12-31',
    originalLines: [raw]
  }, 0);
  console.log(`INPUT: ${s}`);
  console.log(`OUTPUT: ${list[0]?.description || 'FAILED'}\n`);
});
