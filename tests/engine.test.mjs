/**
 * Test del motore di calcolo — esegui con:  node tests/engine.test.mjs   (oppure: npm test)
 * Non servono librerie: usa solo il modulo "assert" di Node.
 */
import assert from 'node:assert/strict';
import { Sheet, formatValue } from '../js/engine.js';
import { parseRef, colToLabel, labelToCol } from '../js/coordinates.js';

let passed = 0, failed = 0;
let note = '';                                   // riga informativa (es. tempi) stampata dopo l'esito
function test(name, fn) {
  note = '';
  try { fn(); passed++; console.log(`  ✔ ${name}`); }
  catch (e) { failed++; console.log(`  ✘ ${name}\n      ${e.message.split('\n')[0]}`); }
  if (note) console.log(`      ${note}`);
}

// Helper: imposta celle con notazione "A1" e legge il valore mostrato
const A = (label) => parseRef(label);
function put(sh, label, raw) { const p = A(label); return sh.setCell(p.col, p.row, raw); }
function show(sh, label) { const p = A(label); return formatValue(sh.valueOf(p.col, p.row)); }

console.log('\nCOORDINATE');
test('colonne A…Z, AA, AZ, CV e viceversa', () => {
  assert.equal(colToLabel(0), 'A'); assert.equal(colToLabel(25), 'Z'); assert.equal(colToLabel(26), 'AA');
  assert.equal(colToLabel(99), 'CV'); assert.equal(labelToCol('CV'), 99); assert.equal(labelToCol('AZ'), 51);
  assert.deepEqual(parseRef('$B$3'), { col: 1, row: 2 }); assert.equal(parseRef('A0'), null);
});

console.log('CASI DI TEST OBBLIGATORI DELLA PROVA');
test('1. A1=5, A2=10, A3==SOMMA(A1:A2) → 15', () => {
  const s = new Sheet(); put(s, 'A1', '5'); put(s, 'A2', '10'); put(s, 'A3', '=SOMMA(A1:A2)');
  assert.equal(show(s, 'A3'), '15');
});
test('2. B1=0, B2==A1/B1 → #DIV/0!', () => {
  const s = new Sheet(); put(s, 'A1', '5'); put(s, 'B1', '0'); put(s, 'B2', '=A1/B1');
  assert.equal(show(s, 'B2'), '#DIV/0!');
});
test('3a. C1==C1 → riferimento circolare', () => {
  const s = new Sheet(); put(s, 'C1', '=C1'); assert.equal(show(s, 'C1'), '#CIRC!');
});
test('3b. catena A1→B1→A1 → circolare su entrambe, poi si risolve', () => {
  const s = new Sheet(); put(s, 'A1', '=B1'); put(s, 'B1', '=A1');
  assert.equal(show(s, 'A1'), '#CIRC!'); assert.equal(show(s, 'B1'), '#CIRC!');
  put(s, 'B1', '7'); assert.equal(show(s, 'A1'), '7');   // spezzando il ciclo A1 torna valido
});
test('3c. catena lunga A1→B1→C1→A1', () => {
  const s = new Sheet(); put(s, 'A1', '=B1+1'); put(s, 'B1', '=C1+1'); put(s, 'C1', '=A1+1');
  assert.equal(show(s, 'A1'), '#CIRC!'); assert.equal(show(s, 'C1'), '#CIRC!');
});
test('4. D1==CONTA.SE(A1:A10;">5") con valori misti → 5', () => {
  const s = new Sheet();
  ['5', '10', '=SOMMA(A1:A2)', '3', '7', '12', 'testo', '8', '1'].forEach((v, i) => put(s, 'A' + (i + 1), v));
  put(s, 'D1', '=CONTA.SE(A1:A10;">5")');
  assert.equal(show(s, 'D1'), '5');                       // 10, 15, 7, 12, 8
});
test('5. E1==SOMMA(A1:CV100) su griglia vuota → 0 (senza crash)', () => {
  const s = new Sheet(); put(s, 'E1', '=SOMMA(A1:CV100)'); assert.equal(show(s, 'E1'), '0');
});
test('7. modifica di una cella con 100 dipendenze → aggiornamento < 300 ms', () => {
  const s = new Sheet(); put(s, 'AA1', '1');
  for (let i = 1; i <= 100; i++) put(s, 'AB' + i, `=$AA$1*${i}+SOMMA(A1:A${i})`);
  const t0 = performance.now(); const r = put(s, 'AA1', '3'); const ms = performance.now() - t0;
  assert.equal(r.evaluated, 100); assert.equal(show(s, 'AB100'), '300');
  assert.ok(ms < 300, `troppo lento: ${ms.toFixed(1)} ms`);
  note = `(misurato: ${ms.toFixed(2)} ms per ricalcolare ${r.evaluated} formule)`;
});

console.log('FUNZIONI DI BASE');
test('SOMMA, MEDIA, MAX, MIN ignorano testo e celle vuote negli intervalli', () => {
  const s = new Sheet(); ['4', 'x', '', '10', '1'].forEach((v, i) => v && put(s, 'A' + (i + 1), v));
  put(s, 'B1', '=SOMMA(A1:A5)'); put(s, 'B2', '=MEDIA(A1:A5)'); put(s, 'B3', '=MAX(A1:A5)'); put(s, 'B4', '=MIN(A1:A5)');
  assert.deepEqual(['B1', 'B2', 'B3', 'B4'].map((l) => show(s, l)), ['15', '5', '10', '1']);
});
test('CONTA conta i numeri, CONTA.VALORI le celle non vuote', () => {
  const s = new Sheet(); put(s, 'A1', '1'); put(s, 'A2', 'ciao'); put(s, 'A4', '3');
  put(s, 'B1', '=CONTA(A1:A5)'); put(s, 'B2', '=CONTA.VALORI(A1:A5)');
  assert.equal(show(s, 'B1'), '2'); assert.equal(show(s, 'B2'), '3');
});
test('intervalli su più colonne (A1:B5)', () => {
  const s = new Sheet(); for (let r = 1; r <= 5; r++) { put(s, 'A' + r, '1'); put(s, 'B' + r, '2'); }
  put(s, 'C1', '=SOMMA(A1:B5)'); assert.equal(show(s, 'C1'), '15');
});
test('intervallo scritto al contrario (B5:A1) equivale a A1:B5', () => {
  const s = new Sheet(); put(s, 'A1', '2'); put(s, 'B5', '3'); put(s, 'C1', '=SOMMA(B5:A1)'); assert.equal(show(s, 'C1'), '5');
});
test('MEDIA di niente → #DIV/0!', () => {
  const s = new Sheet(); put(s, 'A1', '=MEDIA(B1:B5)'); assert.equal(show(s, 'A1'), '#DIV/0!');
});

console.log('OPERATORI E PARENTESI');
test('precedenza: =2+3*4 → 14, =(2+3)*4 → 20, =2^3^2 → 512, =-2^2 → 4', () => {
  const s = new Sheet(); put(s, 'A1', '=2+3*4'); put(s, 'A2', '=(2+3)*4'); put(s, 'A3', '=2^3^2'); put(s, 'A4', '=-2^2');
  assert.deepEqual(['A1', 'A2', 'A3', 'A4'].map((l) => show(s, l)), ['14', '20', '512', '4']);
});
test('=A1+B2*2 e parentesi annidate', () => {
  const s = new Sheet(); put(s, 'A1', '10'); put(s, 'B2', '4'); put(s, 'C1', '=A1+B2*2'); put(s, 'C2', '=((A1+B2)*(2-1))/2');
  assert.equal(show(s, 'C1'), '18'); assert.equal(show(s, 'C2'), '7');
});
test('0.1+0.2 si mostra 0.3; decimali con virgola', () => {
  const s = new Sheet(); put(s, 'A1', '=0.1+0.2'); put(s, 'A2', '3,14'); put(s, 'A3', '=A2*2');
  assert.equal(show(s, 'A1'), '0.3'); assert.equal(show(s, 'A3'), '6.28');
});
test('celle vuote valgono 0 nelle operazioni; testo → #VALORE!', () => {
  const s = new Sheet(); put(s, 'B1', '=A1+5'); put(s, 'A2', 'ciao'); put(s, 'B2', '=A2+1');
  assert.equal(show(s, 'B1'), '5'); assert.equal(show(s, 'B2'), '#VALORE!');
});

console.log('ERRORI');
test('#NOME? (funzione e nome sconosciuti), #RIF! (fuori griglia), sintassi → #VALORE!', () => {
  const s = new Sheet();
  put(s, 'A1', '=PIPPO(1)'); put(s, 'A2', '=ciao+1'); put(s, 'A3', '=A99999'); put(s, 'A4', '=SOMMA(A1:ZZ500)');
  put(s, 'A5', '=SOMMA(1;'); put(s, 'A6', '=1+'); put(s, 'A7', '=');
  assert.deepEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'].map((l) => show(s, l)),
    ['#NOME?', '#NOME?', '#RIF!', '#RIF!', '#VALORE!', '#VALORE!', '#VALORE!']);
});
test('gli errori si propagano alle celle dipendenti', () => {
  const s = new Sheet(); put(s, 'A1', '=1/0'); put(s, 'B1', '=A1+1'); put(s, 'C1', '=SOMMA(A1:B1)');
  assert.equal(show(s, 'B1'), '#DIV/0!'); assert.equal(show(s, 'C1'), '#DIV/0!');
});

console.log('FUNZIONI CONDIZIONALI');
function dataset() {
  const s = new Sheet();
  [['A1', '3'], ['A2', '8'], ['A3', '12'], ['A4', 'mela'], ['A5', '5'], ['A6', 'Mela'], ['B1', '10'], ['B2', '20'], ['B3', '30'], ['B4', '40'], ['B5', '50'], ['B6', '60']]
    .forEach(([l, v]) => put(s, l, v));
  return s;
}
test('SOMMA.SE / CONTA.SE / MEDIA.SE con ">5"', () => {
  const s = dataset();
  put(s, 'D1', '=SOMMA.SE(A1:A6;">5")'); put(s, 'D2', '=CONTA.SE(A1:A6;">5")'); put(s, 'D3', '=MEDIA.SE(A1:A6;">5")');
  assert.deepEqual(['D1', 'D2', 'D3'].map((l) => show(s, l)), ['20', '2', '10']);
});
test('operatori <, <=, >=, =, <>, e numero secco come criterio', () => {
  const s = dataset();
  put(s, 'D1', '=CONTA.SE(A1:A6;"<8")'); put(s, 'D2', '=CONTA.SE(A1:A6;"<=8")'); put(s, 'D3', '=CONTA.SE(A1:A6;">=8")');
  put(s, 'D4', '=CONTA.SE(A1:A6;"=8")'); put(s, 'D5', '=CONTA.SE(A1:A6;8)'); put(s, 'D6', '=CONTA.SE(A1:A6;"<>8")');
  assert.deepEqual(['D1', 'D2', 'D3', 'D4', 'D5', 'D6'].map((l) => show(s, l)), ['2', '3', '2', '1', '1', '5']);
});
test('criterio testuale "mela" (senza maiuscole) e jolly "me*"', () => {
  const s = dataset(); put(s, 'D1', '=CONTA.SE(A1:A6;"mela")'); put(s, 'D2', '=CONTA.SE(A1:A6;"me*")'); put(s, 'D3', '=CONTA.SE(A1:A6;"<>mela")');
  assert.deepEqual(['D1', 'D2', 'D3'].map((l) => show(s, l)), ['2', '2', '4']);
});
test('SOMMA.SE e MEDIA.SE con intervallo somma separato', () => {
  const s = dataset(); put(s, 'D1', '=SOMMA.SE(A1:A6;">5";B1:B6)'); put(s, 'D2', '=MEDIA.SE(A1:A6;"mela";B1:B6)');
  assert.equal(show(s, 'D1'), '50');                                   // B2 + B3 = 20 + 30
  assert.equal(show(s, 'D2'), '50');                                   // (40+60)/2
});
test('MEDIA.SE senza corrispondenze → #DIV/0!; criterio col confronto su celle vuote', () => {
  const s = dataset(); put(s, 'D1', '=MEDIA.SE(A1:A6;">100")'); put(s, 'D2', '=CONTA.SE(A1:A8;"<>mela")');
  assert.equal(show(s, 'D1'), '#DIV/0!'); assert.equal(show(s, 'D2'), '6'); // 4 non-"mela" + 2 celle vuote
});

console.log('EXTRA (bonus)');
test('SE, CONCAT, ARROTONDA, &', () => {
  const s = new Sheet(); put(s, 'A1', '7');
  put(s, 'B1', '=SE(A1>5;"alto";"basso")'); put(s, 'B2', '=CONCAT("a";"-";A1)'); put(s, 'B3', '=ARROTONDA(2,5;0)');
  put(s, 'B4', '=ARROTONDA(-2,5;0)'); put(s, 'B5', '=ARROTONDA(1234,5678;-2)'); put(s, 'B6', '="x"&A1');
  assert.deepEqual(['B1', 'B2', 'B3', 'B4', 'B5', 'B6'].map((l) => show(s, l)), ['alto', 'a-7', '3', '-3', '1200', 'x7']);
});
test('alias inglesi (SUM, IF, COUNTIF…)', () => {
  const s = new Sheet(); put(s, 'A1', '2'); put(s, 'A2', '3'); put(s, 'B1', '=SUM(A1:A2)'); put(s, 'B2', '=COUNTIF(A1:A2;">2")');
  assert.equal(show(s, 'B1'), '5'); assert.equal(show(s, 'B2'), '1');
});

console.log('DIPENDENZE E RICALCOLO');
test('la modifica si propaga a catena (A1→B1→C1)', () => {
  const s = new Sheet(); put(s, 'A1', '1'); put(s, 'B1', '=A1+1'); put(s, 'C1', '=B1*10');
  const r = put(s, 'A1', '5'); assert.equal(show(s, 'C1'), '60'); assert.equal(r.evaluated, 2);
});
test('ricalcolo incrementale: una cella estranea non ricalcola nulla', () => {
  const s = new Sheet(); put(s, 'A1', '1'); put(s, 'B1', '=A1+1'); const r = put(s, 'Z9', '42');
  assert.equal(r.evaluated, 0);
});
test('una formula cambiata in costante non riceve più aggiornamenti (dipendenze ripulite)', () => {
  const s = new Sheet(); put(s, 'A1', '1'); put(s, 'B1', '=A1*2'); put(s, 'B1', '99');
  const r = put(s, 'A1', '5'); assert.equal(r.evaluated, 0); assert.equal(show(s, 'B1'), '99'); assert.equal(s.dependents.size, 0);
});
test('i riferimenti a intervalli vengono aggiornati senza creare un arco per cella', () => {
  const s = new Sheet(); put(s, 'E1', '=SOMMA(A1:CV100)'); put(s, 'A1', '4'); put(s, 'CV100', '6');
  assert.equal(show(s, 'E1'), '10'); assert.equal(s.dependents.size, 0);
});
test('griglia piena 100×100 (10.000 celle) + formule su tutto l\'intervallo, veloce', () => {
  const s = new Sheet(); const t0 = performance.now();
  for (let r = 0; r < 100; r++) for (let c = 0; c < 99; c++) s.setCell(c, r, String(r * 100 + c));
  s.setCell(99, 99, '=SOMMA(A1:CU100)'); s.setCell(99, 0, '=MEDIA(A1:CU100)');
  const fill = performance.now() - t0;
  const t1 = performance.now(); const r1 = s.setCell(0, 0, '1000'); const upd = performance.now() - t1;
  assert.equal(r1.evaluated, 2);
  assert.ok(upd < 300, `aggiornamento lento: ${upd.toFixed(1)} ms`);
  note = `(riempimento 9.900 celle: ${fill.toFixed(0)} ms; modifica con 2 formule su 9.900 celle: ${upd.toFixed(2)} ms)`;
});

console.log('INSERIMENTO / ELIMINAZIONE RIGHE E COLONNE');
test('inserisci riga: le formule seguono le celle spostate', () => {
  const s = new Sheet(); put(s, 'A1', '1'); put(s, 'A2', '2'); put(s, 'A3', '=SOMMA(A1:A2)'); put(s, 'B1', '=A2*10');
  s.insertRows(1, 1);                          // nuova riga prima della riga 2
  assert.equal(s.rows, 101); assert.equal(s.rawOf(0, 2), '2');
  assert.equal(s.rawOf(0, 3), '=SOMMA(A1:A3)'); assert.equal(s.rawOf(1, 0), '=A3*10'); assert.equal(show(s, 'A4'), '3');
});
test('elimina riga: riferimenti a celle eliminate → #RIF!, intervalli si restringono', () => {
  const s = new Sheet(); put(s, 'A1', '1'); put(s, 'A2', '2'); put(s, 'A3', '3'); put(s, 'B1', '=A2'); put(s, 'B2', '=SOMMA(A1:A3)');
  s.deleteRows(1, 1);
  assert.equal(s.rows, 100);                   // la griglia non scende sotto 100 righe
  assert.equal(s.rawOf(1, 0), '=#RIF!'); assert.equal(show(s, 'B1'), '#RIF!');
  assert.equal(s.rawOf(1, 1), '');             // B2 è stata eliminata con la riga 2
  put(s, 'C1', '=SOMMA(A1:A2)'); assert.equal(show(s, 'C1'), '4'); // A3 è diventata A2
});
test('inserisci / elimina colonna', () => {
  const s = new Sheet(); put(s, 'A1', '5'); put(s, 'B1', '=A1+1'); put(s, 'C1', '=B1+A1');
  s.insertCols(0, 1);
  assert.equal(s.cols, 101); assert.equal(s.rawOf(2, 0), '=B1+1'); assert.equal(s.rawOf(3, 0), '=C1+B1'); assert.equal(show(s, 'D1'), '11');
  s.deleteCols(1, 1);                          // elimina la nuova colonna B (con 5): D1 punta a B1 eliminata
  assert.equal(show(s, 'B1'), '#RIF!');
});
test('le stringhe e i nomi di funzione non vengono alterati dallo spostamento', () => {
  const s = new Sheet(); put(s, 'A1', '=CONCAT("B2 ";B2)'); put(s, 'B2', '9'); s.insertRows(0, 1);
  assert.equal(s.rawOf(0, 1), '=CONCAT("B2 ";B3)');
});

console.log('SALVATAGGIO');
test('serialize → load restituisce lo stesso foglio', () => {
  const s = new Sheet(); put(s, 'A1', '5'); put(s, 'A2', '=A1*2'); put(s, 'B1', 'ciao'); s.insertRows(0, 2);
  const t = new Sheet(); t.load(JSON.parse(JSON.stringify(s.serialize())));
  assert.equal(t.rows, 102); assert.equal(show(t, 'A4'), '10'); assert.equal(show(t, 'B3'), 'ciao');
});

console.log(`\nRisultato: ${passed} test superati, ${failed} falliti.\n`);
process.exit(failed ? 1 : 0);
