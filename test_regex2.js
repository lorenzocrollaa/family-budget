const kw = "CALZEDONIA";
const safeKw = kw.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const r = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${safeKw}(?:[^\\p{L}\\p{N}_]|$)`, 'iu');
console.log("CALZEDONIA SPA ->", r.test("CALZEDONIA SPA"));
console.log("CALZEDONIA0123 ->", r.test("CALZEDONIA0123"));
console.log(".includes('CALZEDONIA') su CALZEDONIA0123 ->", "CALZEDONIA0123".includes(kw));
