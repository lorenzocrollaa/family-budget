const keywords = ["H&M", "BAR", "COOP", "POLTRONESOFÀ", "COIN"];
const testStrings = [
  "IL BARBARO",
  "CAFFE BAR SPORT",
  "H&M ROMA",
  "THE H&M",
  "CH&MO", // should not match H&M
  "COOP ITALIA",
  "SCOOP",
  "POLTRONESOFÀ", // Note accented letter
  "COIN SPA",
  "BITCOIN",
  "SUPER BAR, MILANO",
  "LA BAR",
  // testing punctuation
  "ACQUISTO PRESSO H&M-MILANO",
  "SPESA COOP."
];

function buildStrictRegex(kw) {
  const safeKw = kw.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Usiamo Unicode word boundaries se possibile, ma per sicurezza usiamo \s e punteggiatura
  // \b non funziona con "SOFÀ" perché "À" non è \w per l'engine base (senza unicode).
  // Con flag "u", \b funziona con i caratteri unicode? NO in JS standard \b è solo [a-zA-Z0-9_].
  // Quindi un custom boundary è: (?:^|[^\p{L}\p{N}_]) per l'inizio e (?:[^\p{L}\p{N}_]|$) per fine.
  // \p{L} == tutte le lettere incluse accentate.
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_])${safeKw}(?:[^\\p{L}\\p{N}_]|$)`, 'iu');
}

keywords.forEach(kw => {
  const r = buildStrictRegex(kw);
  console.log(`\nTesting Keyword: "${kw}" with regex: ${r}`);
  testStrings.forEach(s => {
    if (r.test(s)) console.log(`  ✅ MATCH: "${s}"`);
    else console.log(`  ❌ NO MATCH: "${s}"`);
  });
});
