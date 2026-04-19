const MpsParser = require('./utils/parsers/mpsParser');
const parser = new MpsParser();
const raw = 'BONIFICO SEPA DISPOSTO TRAMITE CANALE TELEMATICO BON. IST. A108469481701030480328403200IT DATA ACCETT. 21.12.25 * DATA ESEC. 21.12.25 A FAVORE Semenzin Matteo IBAN IT63V36772223000EM001532384 COMM. BON 0,00 CAUS: 048 spese universita';
const list = [];
parser.pushParsedTransaction(list, { dateStr: '21/12/25', description: raw, amount: 100, isIncome: false });
console.log("FINAL DESCRIPTION:", JSON.stringify(list[0].description));
