// Test automatici del motore (casi 1-5 e 7 della prova + casi limite). Esegui: node tests/engine.test.mjs
import { Sheet } from '../js/engine.js';
import { parseRef, idOf } from '../js/coordinates.js';

const id = (a) => { const r = parseRef(a); return idOf(r.c, r.r); };
let failed = 0;
function check(name, got, want) {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} -> "${got}"${ok ? '' : ` (atteso "${want}")`}`);
}
const put = (sh, o) => Object.entries(o).forEach(([k, v]) => sh.set(id(k), String(v)));
const show = (sh, a) => sh.display(id(a));
const F = (sh, a, f) => { sh.set(id(a), f); return show(sh, a); }; // scrive una formula e ne legge il risultato

let s = new Sheet(); put(s, { A1: 5, A2: 10, A3: '=SOMMA(A1:A2)' });
check('1) A3 = SOMMA(A1:A2)', show(s, 'A3'), '15');

s = new Sheet(); put(s, { B1: 0, B2: '=A1/B1' });
check('2) B2 = A1/B1', show(s, 'B2'), '#DIV/0!');

s = new Sheet(); put(s, { C1: '=C1' });
check('3) C1 = C1 (circolare)', show(s, 'C1'), '#CIRC!');
put(s, { A1: '=B1', B1: '=A1', D1: '=A1+1' });
check('3b) catena A1->B1->A1', show(s, 'A1') + ' ' + show(s, 'B1'), '#CIRC! #CIRC!');
check('3c) cella che usa un ciclo', show(s, 'D1'), '#CIRC!');
put(s, { B1: 4 });
check('3d) ciclo spezzato: A1 e D1 tornano validi', show(s, 'A1') + ' ' + show(s, 'D1'), '4 5');

s = new Sheet(); put(s, { A1: 5, A2: 10, A3: '=SOMMA(A1:A2)', A4: 3, A5: 'ciao', A6: 7, D1: '=CONTA.SE(A1:A10;">5")' });
check('4) CONTA.SE(A1:A10;">5") valori misti', show(s, 'D1'), '3');

s = new Sheet(); put(s, { E1: '=SOMMA(A1:CV100)' });
check('5) SOMMA(A1:CV100) griglia vuota', show(s, 'E1'), '0');

s = new Sheet(); put(s, { A1: 1, A2: 2, A3: 'x', A4: 4, B1: 10, B2: 20, B3: 30, B4: 40 });
check('SOMMA ignora il testo', F(s, 'C1', '=SOMMA(A1:A4)'), '7');
check('SOMMA su più colonne', F(s, 'C1', '=SOMMA(A1:B4)'), '107');
check('MEDIA', F(s, 'C1', '=MEDIA(A1:A4)'), '2.33333333333');
check('CONTA (solo numeri)', F(s, 'C1', '=CONTA(A1:A4)'), '3');
check('CONTA.VALORI (non vuote)', F(s, 'C1', '=CONTA.VALORI(A1:A5)'), '4');
check('MAX / MIN', F(s, 'C1', '=MAX(A1:B4)') + ' ' + F(s, 'C2', '=MIN(A1:B4)'), '40 1');
check('SOMMA.SE con 3 argomenti', F(s, 'C1', '=SOMMA.SE(A1:A4;">1";B1:B4)'), '60');
check('MEDIA.SE', F(s, 'C1', '=MEDIA.SE(B1:B4;">=20")'), '30');
check('MEDIA.SE senza corrispondenze', F(s, 'C1', '=MEDIA.SE(B1:B4;">99")'), '#DIV/0!');
check('CONTA.SE su testo', F(s, 'C1', '=CONTA.SE(A1:A4;"x")'), '1');
check('Precedenza e parentesi', F(s, 'C1', '=(A1+A2)*B1-4/2'), '28');
check('Meno unario (come Excel: -2^2 = 4)', F(s, 'C1', '=-A2^2'), '4');
check('Testo in un calcolo', F(s, 'C1', '=A3+1'), '#VALORE!');
check('Funzione inesistente', F(s, 'C1', '=PIPPO(1)'), '#NOME?');
check('Nome inesistente', F(s, 'C1', '=ABC+1'), '#NOME?');
check('Riferimento fuori griglia', F(s, 'C1', '=A101'), '#RIF!');
check('Colonna fuori griglia (CW)', F(s, 'C1', '=CW1+1'), '#RIF!');
check('Sintassi errata', F(s, 'C1', '=1+'), '#VALORE!');
check('Parentesi non chiusa', F(s, 'C1', '=(1+2'), '#VALORE!');
check('Errore propagato', (s.set(id('C1'), '=A1/0'), F(s, 'C2', '=C1+1')), '#DIV/0!');
check('SE / CONCAT / ARROTONDA', F(s, 'C1', '=SE(A1<A2;CONCAT("a";"b");"c")') + ' ' + F(s, 'C2', '=ARROTONDA(2.567;2)'), 'ab 2.57');
check('Numero con virgola', (s.set(id('C1'), '3,5'), F(s, 'C2', '=C1*2')), '7');

// Ricalcolo automatico e selettivo
s = new Sheet(); put(s, { A1: 1, B1: '=A1*2', C1: '=B1+1', D1: '=SOMMA(A1:A3)' });
put(s, { A1: 10 });
check('Ricalcolo a catena', show(s, 'B1') + ' ' + show(s, 'C1') + ' ' + show(s, 'D1'), '20 21 10');
put(s, { A2: 5 });
check('Ricalcolo tramite intervallo', show(s, 'D1'), '15');
check('Solo le dipendenti vengono toccate', String(s.set(id('A3'), '1').length), '2'); // A3 + D1

// 7) 100 dipendenze: aggiornamento entro 300 ms
s = new Sheet(); s.set(id('A1'), '1');
for (let r = 1; r <= 100; r++) s.set(id('B' + r), `=$A$1*${r}+SOMMA(C1:C100)`);
const t0 = performance.now(); const touched = s.set(id('A1'), '7'); const dt = performance.now() - t0;
check('7) 100 dipendenze', `${touched.length} celle`, '101 celle');
check('7) tempo < 300 ms', dt < 300 ? 'sì' : 'no', 'sì'); console.log(`    (${dt.toFixed(2)} ms)`);
check('B100 corretto', show(s, 'B100'), '700');

// Griglia quasi piena (9.999 celle numeriche): somma su un intervallo da 9.900 celle
s = new Sheet();
for (let r = 0; r < 100; r++) for (let c = 0; c < 100; c++) if (r || c) s.raw.set(idOf(c, r), '1');
const t1 = performance.now(); const tot = F(s, 'A1', '=SOMMA(A2:CV100)');
check('SOMMA su 9.900 celle', tot, '9900'); console.log(`    (${(performance.now() - t1).toFixed(2)} ms)`);

console.log(failed ? `\n${failed} TEST FALLITI` : '\nTutti i test superati');
process.exit(failed ? 1 : 0);
